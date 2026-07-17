import path from "path";
import { Worker } from "worker_threads";
import { serverLog } from "../log";

type IncomingMessage =
  | { type: "connect"; host: string; port: number }
  | { type: "disconnect" }
  | { type: "status"; id: string }
  | {
      type: "command";
      id: string;
      command: string;
      timeoutMs?: number;
      expectedCount?: number;
    };

type OutgoingMessage =
  | { type: "connected"; connected: boolean; host: string; port: number }
  | { type: "status"; id: string; connected: boolean; host: string; port: number }
  | { type: "chunk"; id: string; response: string; done: boolean }
  | { type: "result"; id: string; ok: true; response: string }
  | { type: "result"; id: string; ok: false; error: string };

/** One telnet socket — fire panels reject a second simultaneous session. */
let panelWorker: Worker | null = null;

let connected = false;
let currentHost = "";
let currentPort = 23;
let connectInFlight: Promise<void> | null = null;

const pending = new Map<
  string,
  { resolve: (val: unknown) => void; reject: (err: Error) => void }
>();

const chunkHandlers = new Map<
  string,
  (response: string, done: boolean) => void
>();

function addLog(message: string) {
  serverLog(`[fire-panel] ${message}`);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanCommandText(command: string) {
  return String(command || "")
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function getWorkerEntryPath(ext: "js" | "cjs") {
  // When bundled as CJS (MSI resources), __dirname points to the server directory.
  // When bundled as ESM (desktop-server/dist), derive from argv[1] (entry path).
  // eslint-disable-next-line no-undef
  const maybeDir = typeof __dirname === "string" ? __dirname : null;
  if (maybeDir) return path.join(maybeDir, `firePanelWorker.${ext}`);

  const entry = typeof process.argv?.[1] === "string" ? process.argv[1] : "";
  const baseDir = entry ? path.dirname(entry) : process.cwd();
  return path.join(baseDir, `firePanelWorker.${ext}`);
}

/** Resolve paths relative to this service file (works under tsx and packaged builds). */
function getServiceDir() {
  // eslint-disable-next-line no-undef
  if (typeof __dirname === "string") return __dirname;
  return path.join(process.cwd(), "desktop-server", "src", "services");
}

function ensureWorkers() {
  if (panelWorker) return;

  // Prefer the TypeScript worker next to this source file in dev (`npm run desktop:dev`).
  // Packaged builds fall back to compiled firePanelWorker.js beside the server bundle.
  // Preferring dist/*.js first left a stale worker running (stopped after 1 list row).
  const fs = require("fs") as typeof import("fs");

  const serviceDir = getServiceDir();
  const workerPathTs = path.join(serviceDir, "..", "workers", "firePanelWorker.ts");
  const workerPathJs = getWorkerEntryPath("js");
  const workerPathCjs = getWorkerEntryPath("cjs");

  const canUseTsWorker = (() => {
    try {
      fs.accessSync(workerPathTs);
      return true;
    } catch {
      return false;
    }
  })();

  const hasJs = (() => {
    try {
      fs.accessSync(workerPathJs);
      return true;
    } catch {
      return false;
    }
  })();

  const hasCjs = (() => {
    try {
      fs.accessSync(workerPathCjs);
      return true;
    } catch {
      return false;
    }
  })();

  // Dev / tsx: always prefer the live .ts worker so list-dump fixes apply immediately.
  if (canUseTsWorker) {
    addLog(`Using TypeScript fire-panel worker: ${workerPathTs}`);
    panelWorker = new Worker(workerPathTs, {
      execArgv: ["--import", "tsx"],
    });
  } else if (hasJs) {
    addLog(`Using compiled fire-panel worker: ${workerPathJs}`);
    panelWorker = new Worker(workerPathJs);
  } else if (hasCjs) {
    addLog(`Using compiled fire-panel worker: ${workerPathCjs}`);
    panelWorker = new Worker(workerPathCjs);
  } else {
    throw new Error("firePanelWorker not found (js/cjs/ts)");
  }

  panelWorker.on("message", (msg: OutgoingMessage) => {
    if (msg.type === "connected") {
      connected = msg.connected;
      currentHost = msg.host;
      currentPort = msg.port;
      if (!msg.connected) {
        addLog("Telnet socket closed");
      }
      return;
    }

    if (msg.type === "status") {
      const pendingReq = pending.get(msg.id);
      if (!pendingReq) return;
      pending.delete(msg.id);
      connected = msg.connected;
      currentHost = msg.host;
      currentPort = msg.port;
      pendingReq.resolve({
        connected: msg.connected,
        host: msg.host,
        port: msg.port,
      });
      return;
    }

    if (msg.type === "chunk") {
      // Never let stream/UI handlers take down the whole API process.
      try {
        chunkHandlers.get(msg.id)?.(msg.response, msg.done);
      } catch (error) {
        addLog(`chunk handler error: ${(error as Error).message}`);
      }
      return;
    }

    if (msg.type === "result") {
      const pendingReq = pending.get(msg.id);
      if (!pendingReq) return;
      pending.delete(msg.id);
      if (msg.ok) pendingReq.resolve(msg.response);
      else pendingReq.reject(new Error(msg.error));
    }
  });

  panelWorker.on("error", (err) => {
    connected = false;
    addLog(`Panel worker error: ${err.message}`);
  });
}

function request(worker: Worker, msg: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!("id" in msg) || !msg.id) {
      reject(new Error("Worker request is missing id"));
      return;
    }
    pending.set(msg.id, { resolve, reject });
    worker.postMessage(msg);
  });
}

async function readWorkerStatus() {
  ensureWorkers();
  const id = `status-${Date.now()}`;
  const status = (await request(panelWorker!, { type: "status", id })) as {
    connected: boolean;
    host: string;
    port: number;
  };
  connected = status.connected;
  currentHost = status.host;
  currentPort = status.port;
  return status;
}

function ensureConnected() {
  if (!connected) throw new Error("Not connected");
}

export async function connectFirePanel(host: string, port: number) {
  ensureWorkers();

  const existing = await readWorkerStatus();
  if (
    existing.connected &&
    existing.host === host &&
    Number(existing.port) === Number(port)
  ) {
    addLog(`Already connected to ${host}:${port}`);
    return;
  }

  if (connectInFlight) {
    await connectInFlight;
    const after = await readWorkerStatus();
    if (!after.connected) {
      throw new Error("Failed to connect to fire panel");
    }
    return;
  }

  currentHost = host;
  currentPort = port;
  addLog(`Connecting to ${host}:${port}...`);

  connectInFlight = (async () => {
    panelWorker!.postMessage({ type: "connect", host, port } satisfies IncomingMessage);
    // Wait for TCP connect + worker CONNECT_DELAY_MS before status check.
    await sleep(600);

    const status = await readWorkerStatus();
    if (!status.connected) {
      connected = false;
      throw new Error("Failed to connect to fire panel");
    }

    connected = true;
    addLog(`Connected to ${status.host}:${status.port}`);
  })();

  try {
    await connectInFlight;
  } finally {
    connectInFlight = null;
  }
}

export function disconnectFirePanel() {
  if (panelWorker) {
    panelWorker.postMessage({ type: "disconnect" } satisfies IncomingMessage);
  }
  connected = false;
  addLog("Disconnected");
}

export function getFirePanelStatus() {
  return {
    connected,
    host: currentHost,
    port: currentPort,
  };
}

export async function getFirePanelStatusLive() {
  try {
    return await readWorkerStatus();
  } catch {
    return {
      connected: false,
      host: currentHost,
      port: currentPort,
    };
  }
}

async function sendCommandViaWorker(
  command: string,
  timeoutMs?: number,
  onChunk?: (response: string, done: boolean) => void,
  expectedCount?: number,
) {
  ensureWorkers();

  const trimmed = cleanCommandText(command);
  addLog(`Command: ${trimmed}`);

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const msg: IncomingMessage = {
    type: "command",
    id,
    command,
    timeoutMs,
    expectedCount,
  };

  if (onChunk) {
    chunkHandlers.set(id, onChunk);
  }

  try {
    const response = (await request(panelWorker!, msg)) as string;
    if (trimmed.toLowerCase().startsWith("show")) {
      addLog(`show response:\n${response}`);
    }
    return response;
  } finally {
    chunkHandlers.delete(id);
  }
}

export async function sendFirePanelCommandStreaming(
  command: string,
  timeoutMs: number | undefined,
  onChunk: (response: string, done: boolean) => void,
  expectedCount?: number,
) {
  ensureConnected();
  const response = await sendCommandViaWorker(
    command,
    timeoutMs,
    onChunk,
    expectedCount,
  );
  return { response };
}

export async function sendFirePanelCommand(
  command: string,
  timeoutMs?: number,
  expectedCount?: number,
) {
  ensureConnected();
  const response = await sendCommandViaWorker(
    command,
    timeoutMs,
    undefined,
    expectedCount,
  );
  return { response };
}

export async function shutdownFirePanelWorkers() {
  const worker = panelWorker;
  panelWorker = null;
  connected = false;
  if (!worker) return;
  try {
    await worker.terminate();
  } catch {
    // ignore
  }
}
