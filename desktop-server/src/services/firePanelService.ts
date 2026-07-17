import { createRequire } from "module";
import path from "path";
import { Worker } from "worker_threads";
import { serverLog } from "../log";

/** Local require — works under tsx and packaged CJS. */
function localRequire() {
  try {
    // eslint-disable-next-line no-undef
    if (typeof __filename === "string") return createRequire(__filename);
  } catch {
    // ignore
  }
  return createRequire(
    path.join(process.cwd(), "desktop-server", "src", "services", "firePanelService.ts"),
  );
}

type IncomingMessage =
  | { type: "connect"; id: string; host: string; port: number }
  | { type: "disconnect" }
  | { type: "status"; id: string }
  | {
      type: "command";
      id: string;
      command: string;
      timeoutMs?: number;
      expectedCount?: number;
      priority?: boolean;
    };

/** Max time to wait for the worker TCP connect result. */
const CONNECT_REQUEST_TIMEOUT_MS = 15000;

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

function fileExists(filePath: string) {
  try {
    const fs = localRequire()("fs") as typeof import("fs");
    fs.accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Absolute path to tsx so worker `--import` works even when cwd/node_modules differ. */
function resolveTsxImportPath(): string | null {
  try {
    return localRequire().resolve("tsx");
  } catch {
    return null;
  }
}

/**
 * Compile the .ts worker to plain CommonJS next to the source.
 * Avoids "Unknown file extension .ts" when tsx is missing on other machines.
 */
function compileTsWorkerToCjs(workerPathTs: string): string {
  const fs = localRequire()("fs") as typeof import("fs");
  const outFile = path.join(path.dirname(workerPathTs), "firePanelWorker.runtime.cjs");

  let esbuild: { buildSync: (opts: Record<string, unknown>) => void };
  try {
    esbuild = localRequire()("esbuild");
  } catch {
    throw new Error(
      'Panel worker needs a compiled .cjs file (Unknown file extension ".ts"). Run: npm install && npm run desktop:worker:build',
    );
  }

  esbuild.buildSync({
    entryPoints: [workerPathTs],
    outfile: outFile,
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: false,
    logLevel: "silent",
  });

  if (!fs.existsSync(outFile)) {
    throw new Error(`Failed to compile fire panel worker to ${outFile}`);
  }

  return outFile;
}

/** Pick a worker entry that Node can load without a TypeScript loader. */
function resolveWorkerEntry(): { path: string; execArgv?: string[] } {
  const serviceDir = getServiceDir();
  const workersDir = path.join(serviceDir, "..", "workers");
  const workerPathTs = path.join(workersDir, "firePanelWorker.ts");
  const workerRuntimeCjs = path.join(workersDir, "firePanelWorker.runtime.cjs");
  const distJs = path.join(process.cwd(), "desktop-server", "dist", "firePanelWorker.js");
  const packagedJs = getWorkerEntryPath("js");
  const packagedCjs = getWorkerEntryPath("cjs");

  // 1) Packaged / beside this service bundle (MSI resources, dist).
  if (fileExists(packagedCjs)) {
    return { path: packagedCjs };
  }
  if (fileExists(packagedJs)) {
    return { path: packagedJs };
  }

  // 2) Prebuilt runtime CJS from `npm run desktop:worker:build`.
  // Rebuild when the .ts source is newer so other PCs / restarts stay in sync.
  if (fileExists(workerPathTs)) {
    const fs = localRequire()("fs") as typeof import("fs");
    const tsStat = fs.statSync(workerPathTs);
    const runtimeFresh =
      fileExists(workerRuntimeCjs) &&
      fs.statSync(workerRuntimeCjs).mtimeMs >= tsStat.mtimeMs;
    if (runtimeFresh) {
      return { path: workerRuntimeCjs };
    }
    try {
      const compiled = compileTsWorkerToCjs(workerPathTs);
      return { path: compiled };
    } catch (error) {
      if (fileExists(workerRuntimeCjs)) {
        addLog(
          `Worker recompile failed (${(error as Error).message}) — using existing runtime.cjs`,
        );
        return { path: workerRuntimeCjs };
      }
      // fall through to dist / tsx
    }
  } else if (fileExists(workerRuntimeCjs)) {
    return { path: workerRuntimeCjs };
  }

  // 3) esbuild dist output.
  if (fileExists(distJs)) {
    return { path: distJs };
  }

  // 4) Live .ts only when tsx is installed and resolvable (absolute --import).
  const tsxPath = resolveTsxImportPath();
  if (fileExists(workerPathTs) && tsxPath) {
    return { path: workerPathTs, execArgv: ["--import", tsxPath] };
  }

  throw new Error(
    "firePanelWorker not found. Run: npm install && npm run desktop:worker:build",
  );
}

function attachWorkerHandlers(worker: Worker) {
  worker.on("message", (msg: OutgoingMessage) => {
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

  worker.on("error", (err: Error) => {
    connected = false;
    const message = err.message || "unknown worker error";
    addLog(`Panel worker error: ${message}`);
    // Unblock any waiting connect/command so the HTTP handler can return an error.
    const friendly = /unknown file extension.*\.ts/i.test(message)
      ? 'Panel worker failed (Unknown file extension ".ts"). Run npm install && npm run desktop:worker:build, then restart.'
      : `Panel worker error: ${message}`;
    for (const [id, req] of pending) {
      pending.delete(id);
      req.reject(new Error(friendly));
    }
  });

  worker.on("exit", (code) => {
    connected = false;
    panelWorker = null;
    addLog(`Panel worker exited (code ${code})`);
    for (const [id, req] of pending) {
      pending.delete(id);
      req.reject(new Error("Panel worker exited during request"));
    }
  });
}

function ensureWorkers() {
  if (panelWorker) return;

  const entry = resolveWorkerEntry();
  addLog(`Using fire-panel worker: ${entry.path}`);
  panelWorker = entry.execArgv
    ? new Worker(entry.path, { execArgv: entry.execArgv })
    : new Worker(entry.path);

  attachWorkerHandlers(panelWorker);
}

function request(worker: Worker, msg: IncomingMessage, timeoutMs?: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!("id" in msg) || !msg.id) {
      reject(new Error("Worker request is missing id"));
      return;
    }

    const timer =
      timeoutMs && timeoutMs > 0
        ? setTimeout(() => {
            if (!pending.has(msg.id)) return;
            pending.delete(msg.id);
            reject(new Error(`Timed out waiting for fire panel (${timeoutMs}ms)`));
          }, timeoutMs)
        : null;

    pending.set(msg.id, {
      resolve: (val) => {
        if (timer) clearTimeout(timer);
        resolve(val);
      },
      reject: (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      },
    });
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
    const id = `connect-${Date.now()}`;
    try {
      // Wait for the worker's real TCP connect result (success or error).
      await request(
        panelWorker!,
        { type: "connect", id, host, port },
        CONNECT_REQUEST_TIMEOUT_MS,
      );
    } catch (error) {
      connected = false;
      const message = (error as Error).message || "Failed to connect to fire panel";
      // Common Node TCP errors when the panel IP/port is wrong or unreachable.
      if (/ECONNREFUSED/i.test(message)) {
        throw new Error(
          `Panel refused connection at ${host}:${port}. Check IP, port, and that another session is not already connected.`,
        );
      }
      if (/ETIMEDOUT|timed out/i.test(message)) {
        throw new Error(
          `No response from panel at ${host}:${port}. Check LAN connectivity and firewall.`,
        );
      }
      if (/ENETUNREACH|EHOSTUNREACH/i.test(message)) {
        throw new Error(
          `Host unreachable (${host}:${port}). Confirm you are on the same network as the panel.`,
        );
      }
      throw new Error(message);
    }

    // Confirm the socket is still live after the brief settle delay.
    const status = await readWorkerStatus();
    if (!status.connected) {
      connected = false;
      throw new Error(
        `Connected then dropped immediately (${host}:${port}). The panel may already have another telnet session open.`,
      );
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
  priority?: boolean,
) {
  ensureWorkers();

  const trimmed = cleanCommandText(command);
  addLog(`Command${priority ? " [priority]" : ""}: ${trimmed}`);

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const msg: IncomingMessage = {
    type: "command",
    id,
    command,
    timeoutMs,
    expectedCount,
    priority,
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

/**
 * Send a priority command — jumps ahead of any queued list/CVAL work in the worker.
 * Used for ack/silence where waiting behind a 200-row list dump is unacceptable.
 */
export async function sendFirePanelCommandPriority(
  command: string,
  timeoutMs?: number,
) {
  ensureConnected();
  const response = await sendCommandViaWorker(command, timeoutMs, undefined, undefined, true);
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
