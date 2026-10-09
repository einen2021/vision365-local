import { createRequire } from "module";
import path from "path";
import { Worker } from "worker_threads";
import { serverLog, clearServerLogFile } from "../log";
import { getSqlite } from "../db/client";

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
  | { type: "result"; id: string; ok: false; error: string }
  | { type: "panel-log"; entry: PanelLogEntry };

// ---------------------------------------------------------------------------
// Panel log — persistence + real-time SSE broadcast
// ---------------------------------------------------------------------------

export type PanelLogKind =
  | "fire"
  | "trouble"
  | "supervisory"
  | "acknowledged"
  | "fire-acknowledged"
  | "reset-in-progress"
  | "reset-normal"
  | "reset-complete"
  | "reset-aborted"
  | "reset"
  | "cval"
  | "system"
  | "noise"
  | "other"
  | "unparsed";

export interface PanelLogEntry {
  kind: PanelLogKind;
  raw: string;
  at: string;
  time?: string;
  weekday?: string;
  date?: string;
  location?: string;
  device?: string | null;
  status?: string;
  pointId?: string;
  description?: string;
  isListEntry?: boolean;
  register?: "a0" | "a1" | "a2";
  cval?: number;
  systemType?: "error" | "login-success" | "banner";
}

export interface StoredPanelLog extends PanelLogEntry {
  id: number;
}

/** Ring-buffer cap for panel_logs table. */
const PANEL_LOG_MAX_ROWS = 2000;
const PANEL_LOG_TRIM_EVERY = 100;
let insertsSinceTrim = 0;

type LogSender = (entry: StoredPanelLog) => void;
const panelLogSubscribers = new Set<LogSender>();

function insertPanelLog(entry: PanelLogEntry): StoredPanelLog | null {
  try {
    const db = getSqlite();
    const { lastInsertRowid } = db
      .prepare(
        "INSERT INTO panel_logs (kind, raw, data, at) VALUES (?, ?, ?, ?)",
      )
      .run(
        entry.kind,
        entry.raw.slice(0, 2000), // guard runaway raw lines
        JSON.stringify(entry),
        entry.at,
      );

    // Ring buffer: delete anything older than the last PANEL_LOG_MAX_ROWS rows.
    // Trimmed every PANEL_LOG_TRIM_EVERY inserts — a list dump logs hundreds of
    // lines and one DELETE per line doubled the write cost.
    insertsSinceTrim += 1;
    if (insertsSinceTrim >= PANEL_LOG_TRIM_EVERY) {
      insertsSinceTrim = 0;
      db.prepare(
        `DELETE FROM panel_logs WHERE id <= (SELECT MAX(id) - ? FROM panel_logs)`,
      ).run(PANEL_LOG_MAX_ROWS);
    }

    return { ...entry, id: Number(lastInsertRowid) };
  } catch {
    return null;
  }
}

function broadcastPanelLog(stored: StoredPanelLog) {
  for (const send of panelLogSubscribers) {
    try {
      send(stored);
    } catch {
      // ignore — client disconnected
    }
  }
}

/** Broadcast and persist a custom system message to panel logs. */
export function logSystemMessage(raw: string): StoredPanelLog | null {
  const stored = insertPanelLog({
    kind: "system",
    systemType: "banner",
    raw,
    description: raw,
    at: new Date().toISOString(),
  });
  if (stored) broadcastPanelLog(stored);
  return stored;
}

/** Broadcast and persist a simulated panel log entry (for debug/demo mode). */
export function simulatePanelLogEntry(entry: PanelLogEntry): StoredPanelLog | null {
  const stored = insertPanelLog(entry);
  if (stored) broadcastPanelLog(stored);
  return stored;
}

/**
 * Subscribe to live panel log entries (SSE clients).
 * Returns an unsubscribe function.
 */
export function subscribeToLivePanelLogs(
  send: LogSender,
): () => void {
  panelLogSubscribers.add(send);
  return () => panelLogSubscribers.delete(send);
}

/** Fetch the last `limit` panel log rows from SQLite. */
export function getRecentPanelLogs(limit = 200): StoredPanelLog[] {
  try {
    const db = getSqlite();
    const rows = db
      .prepare(
        "SELECT id, kind, raw, data, at FROM panel_logs ORDER BY id DESC LIMIT ?",
      )
      .all(limit) as Array<{ id: number; kind: string; raw: string; data: string; at: string }>;

    return rows
      .map((row) => {
        let parsed: Partial<PanelLogEntry> = {};
        try {
          parsed = JSON.parse(row.data) as Partial<PanelLogEntry>;
        } catch {
          // ignore
        }
        return {
          ...parsed,
          id: row.id,
          kind: row.kind as PanelLogKind,
          raw: row.raw,
          at: row.at,
        } as StoredPanelLog;
      })
      .reverse(); // oldest first for display
  } catch {
    return [];
  }
}

/**
 * Clear all saved panel logs from SQLite and broadcast a clear event to live subscribers.
 * Optionally also resets the server.log file.
 */
export function clearPanelLogs(clearFileLog = true): { deleted: number } {
  try {
    const db = getSqlite();
    const result = db.prepare("DELETE FROM panel_logs").run();
    const deleted = Number(result.changes);

    if (clearFileLog) {
      clearServerLogFile();
    }

    serverLog(`Panel logs cleared by administrator (${deleted} entries deleted)`);

    // Notify connected SSE clients that saved logs have been cleared
    const clearNotice: StoredPanelLog = {
      id: 0,
      kind: "system",
      systemType: "banner",
      raw: "[SYSTEM] Previous saved logs were cleared by administrator.",
      description: "Previous saved logs were cleared by administrator.",
      at: new Date().toISOString(),
      // @ts-expect-error extra property for live UI sync
      cleared: true,
    };
    broadcastPanelLog(clearNotice);

    return { deleted };
  } catch (err) {
    serverLog(`Failed to clear panel logs: ${(err as Error).message}`);
    return { deleted: 0 };
  }
}

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

    // Live panel stream — persist to DB and broadcast to SSE subscribers
    if (msg.type === "panel-log") {
      const stored = insertPanelLog(msg.entry);
      if (stored) broadcastPanelLog(stored);
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

function isDebugModeServer(): boolean {
  return (
    process.env.DEBUG_MODE === "true" ||
    process.env.NEXT_PUBLIC_DEBUG_MODE === "true" ||
    process.env.DEBUG_MODE === "1" ||
    process.env.NEXT_PUBLIC_DEBUG_MODE === "1"
  );
}

export async function connectFirePanel(host: string, port: number) {
  if (isDebugModeServer()) {
    connected = true;
    currentHost = "Debug Mode";
    currentPort = port || 23;
    addLog(`[Debug Mode] Skipping telnet TCP connection to ${host}:${port}`);
    return;
  }

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
  addLog(`Command: ${trimmed}`);

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
    } else if (trimmed.toLowerCase().startsWith("login")) {
      addLog(`login response: ${JSON.stringify(String(response).slice(0, 200))}`);
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
 * Priority command — the worker ranks it by command type (ack/login/set first)
 * and cancels + restarts any lower-rank list dump in progress.
 */
export async function sendFirePanelCommandPriority(
  command: string,
  timeoutMs?: number,
) {
  ensureConnected();
  const response = await sendCommandViaWorker(command, timeoutMs, undefined, undefined, true);
  return { response };
}

/**
 * Several priority commands posted to the worker in one tick (e.g. login + set
 * 2/3/4:p217 on) so they queue back-to-back with nothing interleaved.
 */
export async function sendFirePanelCommandsPriority(
  commands: string[],
  timeoutMs?: number,
) {
  ensureConnected();
  const responses = await Promise.all(
    commands.map((command) =>
      sendCommandViaWorker(command, timeoutMs, undefined, undefined, true),
    ),
  );
  return { responses };
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
