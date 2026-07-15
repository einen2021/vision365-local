import net from "net";
import { parentPort } from "worker_threads";

type IncomingMessage =
  | { type: "connect"; host: string; port: number }
  | { type: "disconnect" }
  | { type: "status"; id: string }
  | { type: "command"; id: string; command: string; timeoutMs?: number };

type OutgoingMessage =
  | { type: "connected"; connected: boolean; host: string; port: number }
  | { type: "status"; id: string; connected: boolean; host: string; port: number }
  | { type: "chunk"; id: string; response: string; done: boolean }
  | { type: "result"; id: string; ok: true; response: string }
  | { type: "result"; id: string; ok: false; error: string };

const CONNECT_DELAY_MS = 300;
const COMMAND_TIMEOUT_MS = 2000;
const LIST_COMMAND_TIMEOUT_MS = 15000;
const SHOW_COMMAND_TIMEOUT_MS = 8000;
const BULK_COMMAND_TIMEOUT_MS = 60000;
/** Resolve when no bytes arrive for this long (panel finished sending) */
const IDLE_COMPLETE_MS = 100;
const SHOW_IDLE_COMPLETE_MS = 300;
const CVAL_IDLE_COMPLETE_MS = 450;
const LIST_IDLE_COMPLETE_MS = 250;

let client: net.Socket | null = null;
let currentHost = "";
let currentPort = 23;
let connectInFlight: Promise<void> | null = null;

/** Serialize telnet commands — only one in flight on the socket at a time */
let commandChain: Promise<unknown> = Promise.resolve();

/** Active command fail handlers — cleared when the socket drops mid-command. */
const activeCommandFails = new Set<(err: Error) => void>();

function failActiveCommands(reason: string) {
  const err = new Error(reason);
  for (const fail of [...activeCommandFails]) {
    try {
      fail(err);
    } catch {
      // ignore
    }
  }
  activeCommandFails.clear();
}

function isSocketLive(socket: net.Socket | null) {
  return Boolean(socket && !socket.destroyed && socket.writable);
}

async function connect(host: string, port: number) {
  if (isSocketLive(client) && currentHost === host && currentPort === port) {
    post({ type: "connected", connected: true, host: currentHost, port: currentPort });
    return;
  }

  if (connectInFlight) {
    await connectInFlight;
    if (!isSocketLive(client)) {
      throw new Error("Failed to connect to fire panel");
    }
    return;
  }

  connectInFlight = (async () => {
    if (client) {
      client.removeAllListeners("close");
      client.removeAllListeners("error");
      client.destroy();
      client = null;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setKeepAlive(true, 15000);
      socket.setNoDelay(true);
      // Detect dead peers faster on Windows LAN drops.
      socket.setTimeout(0);
      socket.once("error", (err) => reject(err));
      socket.connect(port, host, () => {
        client = socket;
        currentHost = host;
        currentPort = port;
        attachSocketHandlers(socket);
        setTimeout(resolve, CONNECT_DELAY_MS);
      });
    });

    post({ type: "connected", connected: true, host: currentHost, port: currentPort });
  })();

  try {
    await connectInFlight;
  } finally {
    connectInFlight = null;
  }
}

function enqueueCommand<T>(fn: () => Promise<T>): Promise<T> {
  const run = commandChain.then(fn, fn);
  commandChain = run.catch(() => {});
  return run;
}

function post(msg: OutgoingMessage) {
  parentPort?.postMessage(msg);
}

/** Remove hidden control chars (paste/JSON) and collapse whitespace. */
function cleanCommandText(command: string) {
  return command
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function timeoutForCommand(command: string, overrideMs?: number) {
  if (overrideMs && overrideMs > 0) return overrideMs;
  const trimmed = cleanCommandText(command).toLowerCase();
  if (trimmed.includes("cshow *") || trimmed.includes("cshow*"))
    return BULK_COMMAND_TIMEOUT_MS;
  if (trimmed.startsWith("list")) return LIST_COMMAND_TIMEOUT_MS;
  if (trimmed.startsWith("show")) return SHOW_COMMAND_TIMEOUT_MS;
  if (trimmed.startsWith("cshow") && trimmed.includes("cval")) return 3000;
  return COMMAND_TIMEOUT_MS;
}

function idleMsForCommand(command: string) {
  const trimmed = cleanCommandText(command).toLowerCase();
  if (isCvalCommand(command)) return CVAL_IDLE_COMPLETE_MS;
  if (trimmed.startsWith("show")) return SHOW_IDLE_COMPLETE_MS;
  if (
    trimmed.startsWith("list") ||
    trimmed.includes("cshow *") ||
    trimmed.includes("cshow*")
  ) {
    return LIST_IDLE_COMPLETE_MS;
  }
  return IDLE_COMPLETE_MS;
}

function isDefiniteComplete(response: string) {
  return /_DNE/i.test(sanitizePanelText(response));
}

/** NUL-padded panel columns look blank in logs but break \s-based matching. */
function sanitizePanelText(text: string) {
  return String(text || "").replace(/\0/g, " ");
}

function isQuickComplete(command: string, response: string) {
  const trimmed = cleanCommandText(command).toLowerCase();
  const text = sanitizePanelText(response);
  if (trimmed.startsWith("cshow") && trimmed.includes("cval")) {
    return /CVAL\s*=\s*\d+/i.test(text);
  }
  if (trimmed.startsWith("login")) {
    return /ACCESS GRANTED/i.test(text) || /INVALID PASSCODE/i.test(text);
  }
  if (trimmed.startsWith("show")) {
    return (
      /PRIMARY\s+STATUS(?:\s*:|\s{2,})\s*\S/i.test(text) &&
      /ENABLED\s+STATE(?:\s*:|\s{2,})\s*\S/i.test(text)
    );
  }
  return false;
}

function isListCommand(command: string) {
  return cleanCommandText(command).toLowerCase().startsWith("list");
}

function isCvalCommand(command: string) {
  const trimmed = cleanCommandText(command).toLowerCase();
  return trimmed.startsWith("cshow") && trimmed.includes("cval");
}

// Panel service port expects CR (PuTTY default). LF causes login passcode failures.
function normalizeCommand(command: string) {
  const cleaned = cleanCommandText(command);
  if (!cleaned) return "\r";
  return `${cleaned}\r`;
}

function ensureConnected() {
  if (!isSocketLive(client)) {
    throw new Error("Not connected");
  }
}

function attachSocketHandlers(socket: net.Socket) {
  socket.on("close", () => {
    if (client !== socket) return;
    client = null;
    failActiveCommands("Not connected");
    // Reset command queue so a reconnect is not blocked by a hung prior command.
    commandChain = Promise.resolve();
    post({ type: "connected", connected: false, host: currentHost, port: currentPort });
  });
  socket.on("error", (err) => {
    // Keep the socket unless the panel closed it — commands report their own errors.
    if (client === socket && /ECONNRESET|EPIPE|ETIMEDOUT/i.test(err.message || "")) {
      client = null;
      failActiveCommands(err.message || "Not connected");
      commandChain = Promise.resolve();
      post({ type: "connected", connected: false, host: currentHost, port: currentPort });
    }
  });
}

function disconnect() {
  if (client) {
    client.removeAllListeners("close");
    client.removeAllListeners("error");
    client.end();
    client.destroy();
    client = null;
  }
  failActiveCommands("Not connected");
  commandChain = Promise.resolve();
  post({ type: "connected", connected: false, host: currentHost, port: currentPort });
}

function sendCommand(command: string, timeoutMs?: number, commandId?: string) {
  return enqueueCommand(() => sendCommandOnce(command, timeoutMs, commandId));
}

function sendCommandOnce(command: string, timeoutMs?: number, commandId?: string) {
  ensureConnected();
  const socket = client as net.Socket;
  const normalized = normalizeCommand(command);
  const maxWaitMs = timeoutForCommand(command, timeoutMs);
  const idleMs = idleMsForCommand(command);

  return new Promise<string>((resolve, reject) => {
    let response = "";
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let lastChunkPost = 0;
    const streamingList = isListCommand(command) && Boolean(commandId);

    const emitChunk = (done: boolean) => {
      if (!streamingList || !commandId) return;
      post({ type: "chunk", id: commandId, response, done });
      lastChunkPost = Date.now();
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      activeCommandFails.delete(fail);
      clearTimeout(hardTimeout);
      if (idleTimer) clearTimeout(idleTimer);
      socket.removeListener("data", onData);
      if (streamingList) emitChunk(true);
      // Return NUL-cleaned text so Asset Control can parse PRIMARY STATUS / ENABLED STATE.
      const cleaned = cleanCommandText(command).toLowerCase().startsWith("show")
        ? sanitizePanelText(response)
        : response;
      resolve(cleaned);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      activeCommandFails.delete(fail);
      clearTimeout(hardTimeout);
      if (idleTimer) clearTimeout(idleTimer);
      socket.removeListener("data", onData);
      reject(err);
    };

    activeCommandFails.add(fail);

    const scheduleIdleComplete = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (response.length === 0) return;
        // List output ends with _DNE — keep reading until the panel marks done
        if (isListCommand(command) && !isDefiniteComplete(response)) {
          return;
        }
        // CVAL responses often arrive in multiple chunks — wait until CVAL= is present
        if (isCvalCommand(command) && !/CVAL\s*=\s*\d+/i.test(response)) {
          scheduleIdleComplete();
          return;
        }
        if (
          cleanCommandText(command).toLowerCase().startsWith("show") &&
          !(
            /PRIMARY\s+STATUS(?:\s*:|\s{2,})\s*\S/i.test(sanitizePanelText(response)) &&
            /ENABLED\s+STATE(?:\s*:|\s{2,})\s*\S/i.test(sanitizePanelText(response))
          )
        ) {
          scheduleIdleComplete();
          return;
        }
        finish();
      }, idleMs);
    };

    const hardTimeout = setTimeout(() => {
      // Never return a partial `show` — Asset Control needs PRIMARY STATUS + ENABLED STATE.
      if (cleanCommandText(command).toLowerCase().startsWith("show")) {
        if (isQuickComplete(command, response)) {
          finish();
          return;
        }
        fail(new Error("Timeout waiting for complete show response"));
        return;
      }
      if (response.length > 0) {
        finish();
        return;
      }
      fail(new Error("Timeout waiting for response"));
    }, maxWaitMs);

    function onData(data: Buffer) {
      response += data.toString();

      if (streamingList) {
        const now = Date.now();
        const text = data.toString();
        const hasNewline = text.includes("\n") || text.includes("\r");
        if (
          hasNewline ||
          isDefiniteComplete(response) ||
          now - lastChunkPost >= 120
        ) {
          emitChunk(isDefiniteComplete(response));
        }
      }

      if (isDefiniteComplete(response)) {
        finish();
        return;
      }

      if (isQuickComplete(command, response)) {
        scheduleIdleComplete();
        return;
      }

      scheduleIdleComplete();
    }

    socket.on("data", onData);
    socket.write(normalized, (err) => {
      if (err) fail(err);
    });
  });
}

function shouldAcceptCommand(_command: string) {
  return true;
}

parentPort?.on("message", (msg: IncomingMessage) => {
  if (msg.type === "connect") {
    void connect(msg.host, msg.port).catch((err) => {
      post({ type: "result", id: "connect", ok: false, error: (err as Error).message });
    });
    return;
  }

  if (msg.type === "disconnect") {
    disconnect();
    return;
  }

  if (msg.type === "status") {
    post({
      type: "status",
      id: msg.id,
      connected: isSocketLive(client),
      host: currentHost,
      port: currentPort,
    });
    return;
  }

  if (msg.type === "command") {
    if (!shouldAcceptCommand(msg.command)) {
      post({
        type: "result",
        id: msg.id,
        ok: false,
        error: "Worker refused command",
      });
      return;
    }

    void sendCommand(msg.command, msg.timeoutMs, msg.id)
      .then((response) => post({ type: "result", id: msg.id, ok: true, response }))
      .catch((err) => post({ type: "result", id: msg.id, ok: false, error: (err as Error).message }));
  }
});

