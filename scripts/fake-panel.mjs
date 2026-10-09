/**
 * Fake Simplex panel telnet service for local latency testing.
 *
 *   node scripts/fake-panel.mjs [port=2323] [rows=200] [rowDelayMs=30] [mode=abort]
 *
 * mode: "abort" — a new command line stops the dump in progress;
 *       "queue" — input waits until the dump in progress has finished.
 *
 * Echoes each command, logs when it was received, and answers:
 *   list f|t|s  → `rows` device rows sent one every `rowDelayMs`, then "-" prompt
 *   show counts → FIRE / TROUBLE / SUPERVISORY totals
 *   login …     → ACCESS GRANTED
 *   set / ack   → (echo + prompt only)
 * Connect the app (or scripts/fake-panel-bench.mjs) to 127.0.0.1:<port>.
 */
import net from "net";

const port = Number(process.argv[2] || 2323);
const rows = Number(process.argv[3] || 200);
const rowDelayMs = Number(process.argv[4] || 30);
const mode = process.argv[5] === "queue" ? "queue" : "abort";
const STATUS = { f: "FIRE*", t: "TRBL*", s: "SUPV*" };
const start = Date.now();
const stamp = () => `+${String(Date.now() - start).padStart(6)}ms`;

const server = net.createServer((sock) => {
  console.log(`${stamp()} client connected`);
  const session = { sock, dump: null, waiting: [] };
  let pending = "";

  sock.on("data", (data) => {
    pending += data.toString("utf8");
    let idx;
    while ((idx = pending.indexOf("\n")) !== -1) {
      const cmd = pending.slice(0, idx).replace(/\r$/, "").trim();
      pending = pending.slice(idx + 1);
      if (!cmd) continue;
      if (session.dump && mode === "queue") {
        session.waiting.push(cmd);
        continue;
      }
      if (session.dump) {
        clearInterval(session.dump);
        session.dump = null;
        console.log(`${stamp()} ABORT dump`);
      }
      handle(session, cmd);
    }
  });
  sock.on("error", () => {});
});

function handle(session, cmd) {
  const { sock } = session;
  console.log(`${stamp()} RECV ${cmd}`);
  sock.write(`${cmd}\r\n`);
  const lower = cmd.toLowerCase();

  const list = /^list\s+([fts])/.exec(lower);
  if (list) {
    const status = STATUS[list[1]];
    let i = 0;
    session.dump = setInterval(() => {
      if (sock.destroyed) return clearInterval(session.dump);
      if (i >= rows) {
        clearInterval(session.dump);
        session.dump = null;
        sock.write("\r\n -\r\n");
        console.log(`${stamp()} DONE ${cmd}`);
        while (!session.dump && session.waiting.length) handle(session, session.waiting.shift());
        return;
      }
      i += 1;
      sock.write(`2:M1-${i}-0   FLOOR ${i} CORRIDOR   SMOKE DETECTOR   ${status}\r\n`);
    }, rowDelayMs);
    return;
  }
  if (lower.startsWith("show counts")) {
    sock.write(`FIRE = ${rows}  PRIORITY2 = 0  SUPERVISORY = ${rows}  TROUBLE = ${rows}\r\n -\r\n`);
    return;
  }
  if (lower.startsWith("login")) {
    sock.write("ACCESS GRANTED\r\n -\r\n");
    return;
  }
  sock.write(" -\r\n");
}

server.listen(port, () => {
  console.log(`fake panel on 127.0.0.1:${port} (${rows} rows, ${rowDelayMs}ms/row, ${mode})`);
});
