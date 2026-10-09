/**
 * Drive the built panel worker against scripts/fake-panel.mjs and time how long
 * an ack / silence batch waits while a long `list t` dump is in progress.
 *
 *   npm run desktop:worker:build
 *   node scripts/fake-panel.mjs 2323 200 30     (separate terminal)
 *   node scripts/fake-panel-bench.mjs 2323 200
 */
import path from "path";
import { fileURLToPath } from "url";
import { Worker } from "worker_threads";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.argv[2] || 2323);
const rows = Number(process.argv[3] || 200);
const worker = new Worker(
  path.join(__dirname, "..", "desktop-server/src/workers/firePanelWorker.runtime.cjs"),
);

const pending = new Map();
let seq = 0;
worker.on("message", (msg) => {
  if (msg.type !== "result") return;
  const req = pending.get(msg.id);
  if (!req) return;
  pending.delete(msg.id);
  req({ ...msg, at: Date.now() });
});

function send(fields) {
  const id = `b${++seq}`;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    worker.postMessage({ id, ...fields });
  });
}

const countRows = (text) => new Set(String(text).match(/\b2:M1-\d+-0\b/g) || []).size;

const connected = await send({ type: "connect", host: "127.0.0.1", port });
if (!connected.ok) {
  console.error("connect failed:", connected.error);
  process.exit(1);
}

const t0 = Date.now();
const listPromise = send({ type: "command", command: "list t", timeoutMs: 5000, expectedCount: rows });

await new Promise((r) => setTimeout(r, 1000));
const ackSent = Date.now();
const ack = await send({ type: "command", command: "ack", timeoutMs: 2000, priority: true });
console.log(`ack resolved ${ack.at - ackSent}ms after send (ok=${ack.ok})`);

const silenceSent = Date.now();
const silence = await Promise.all(
  ["login 333", "set 2:p217 on", "set 3:p217 on", "set 4:p217 on"].map((command) =>
    send({ type: "command", command, timeoutMs: 2000, priority: true }),
  ),
);
console.log(
  `silence batch resolved ${Math.max(...silence.map((r) => r.at)) - silenceSent}ms after send (ok=${silence.every((r) => r.ok)})`,
);

const list = await listPromise;
console.log(
  `list t resolved after ${list.at - t0}ms with ${countRows(list.response)}/${rows} rows (ok=${list.ok})`,
);
await worker.terminate();
