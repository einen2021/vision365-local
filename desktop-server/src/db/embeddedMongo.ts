/**
 * Starts embedded MongoDB for offline desktop use.
 * - Production: Tauri spawns bundled mongod and sets VISION365_MONGO_URI
 * - Dev fallback: spawns bundled mongod or downloads via mongodb-memory-server
 *
 * Exit code 62 = data files incompatible with this mongod version.
 * We never crash the API on that — quarantine the bad dbpath and start fresh,
 * then seed/restore from JSON backups + floor-plans under AppData.
 */

import { spawn, execFile, type ChildProcess } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import net from "net";

const execFileAsync = promisify(execFile);

const DEFAULT_PORT = 47820;

let mongodProcess: ChildProcess | null = null;
let memoryServer: {
  stop: () => Promise<boolean>;
  getUri: () => string;
} | null = null;
let mongodDownloadPromise: Promise<string | null> | null = null;

export function getEmbeddedMongoPort(): number {
  return Number(process.env.VISION365_MONGO_PORT || DEFAULT_PORT);
}

export function getMongoUri(port = getEmbeddedMongoPort()): string {
  return process.env.VISION365_MONGO_URI || `mongodb://127.0.0.1:${port}`;
}

function resolveMongodPath(): string | null {
  if (
    process.env.VISION365_MONGOD_PATH &&
    fs.existsSync(process.env.VISION365_MONGOD_PATH)
  ) {
    return process.env.VISION365_MONGOD_PATH;
  }

  const exe = process.platform === "win32" ? "mongod.exe" : "mongod";
  const candidates = [
    path.join(process.cwd(), "src-tauri", "resources", "mongodb", "bin", exe),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

/**
 * Ensure portable mongod exists under src-tauri/resources/mongodb.
 * Runs scripts/download-mongodb.mjs once when the binary is missing.
 */
async function ensureBundledMongod(): Promise<string | null> {
  const existing = resolveMongodPath();
  if (existing) return existing;

  if (mongodDownloadPromise) return mongodDownloadPromise;

  mongodDownloadPromise = (async () => {
    const script = path.join(process.cwd(), "scripts", "download-mongodb.mjs");
    if (!fs.existsSync(script)) {
      console.warn(
        `[mongo] Bundled mongod missing and download script not found: ${script}`,
      );
      return null;
    }

    console.log(
      "[mongo] Bundled mongod not found — downloading into src-tauri/resources/mongodb ...",
    );
    try {
      await execFileAsync(process.execPath, [script], {
        cwd: process.cwd(),
        windowsHide: true,
        maxBuffer: 20 * 1024 * 1024,
      });
    } catch (error) {
      console.warn(
        `[mongo] Failed to download bundled mongod: ${(error as Error).message}`,
      );
      return null;
    }

    const downloaded = resolveMongodPath();
    if (downloaded) {
      console.log(`[mongo] Bundled mongod ready at ${downloaded}`);
    } else {
      console.warn(
        "[mongo] Download finished but mongod binary still missing — falling back to memory-server",
      );
    }
    return downloaded;
  })();

  try {
    return await mongodDownloadPromise;
  } finally {
    mongodDownloadPromise = null;
  }
}

function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryConnect = () => {
      const socket = net.createConnection({ host: "127.0.0.1", port }, () => {
        socket.end();
        resolve();
      });

      socket.on("error", () => {
        socket.destroy();
        if (Date.now() >= deadline) {
          reject(
            new Error(
              `MongoDB did not start on port ${port} within ${timeoutMs}ms`,
            ),
          );
          return;
        }
        setTimeout(tryConnect, 300);
      });
    };

    tryConnect();
  });
}

function removeStaleLocks(dbPath: string) {
  for (const name of ["mongod.lock", "WiredTiger.lock"]) {
    const lockPath = path.join(dbPath, name);
    try {
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    } catch {
      // ignore
    }
  }
}

/** Move incompatible/corrupt data aside so a clean mongod can start. */
function quarantineDbPath(dbPath: string, reason: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const parent = path.dirname(dbPath);
  const quarantine = path.join(parent, `mongodb-quarantine-${stamp}`);
  try {
    if (fs.existsSync(dbPath)) {
      fs.renameSync(dbPath, quarantine);
      console.warn(
        `[mongo] Quarantined incompatible dbpath (${reason}): ${quarantine}`,
      );
    }
  } catch (error) {
    console.warn(
      `[mongo] Could not quarantine ${dbPath}: ${(error as Error).message} — recreating empty folder`,
    );
    try {
      fs.rmSync(dbPath, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  fs.mkdirSync(dbPath, { recursive: true });
  return quarantine;
}

function dbPathHasDataFiles(dbPath: string): boolean {
  try {
    if (!fs.existsSync(dbPath)) return false;
    return fs.readdirSync(dbPath).some((name) => {
      const lower = name.toLowerCase();
      return (
        lower.startsWith("wiredtiger") ||
        lower.endsWith(".wt") ||
        lower === "storage.bson" ||
        lower === "collection" ||
        lower === "index"
      );
    });
  } catch {
    return false;
  }
}

async function spawnBundledMongod(
  dbPath: string,
  port: number,
): Promise<string> {
  const mongodPath = resolveMongodPath();
  if (!mongodPath) {
    throw new Error("Bundled mongod binary not found");
  }

  fs.mkdirSync(dbPath, { recursive: true });
  removeStaleLocks(dbPath);

  const uri = `mongodb://127.0.0.1:${port}`;

  const attemptStart = (): Promise<void> =>
    new Promise((resolve, reject) => {
      let settled = false;
      let stderrBuf = "";

      mongodProcess = spawn(
        mongodPath,
        ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1"],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );

      mongodProcess.stderr?.on("data", (chunk: Buffer) => {
        const line = chunk.toString();
        stderrBuf += line;
        const trimmed = line.trim();
        if (trimmed) console.log(`[mongod] ${trimmed}`);
      });

      mongodProcess.on("error", (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });

      mongodProcess.on("exit", (code) => {
        if (settled) return;
        settled = true;
        mongodProcess = null;
        const err = new Error(
          `mongod exited with code ${code}${stderrBuf ? `: ${stderrBuf.slice(-400)}` : ""}`,
        );
        (err as Error & { exitCode?: number | null }).exitCode = code;
        reject(err);
      });

      void waitForPort(port, 60000)
        .then(() => {
          if (settled) return;
          settled = true;
          // Keep listening for later crashes, but startup succeeded.
          mongodProcess?.removeAllListeners("exit");
          mongodProcess?.on("exit", (code) => {
            console.error(`[mongod] Process exited unexpectedly with code ${code}`);
            mongodProcess = null;
          });
          resolve();
        })
        .catch((err) => {
          if (settled) return;
          settled = true;
          try {
            mongodProcess?.kill();
          } catch {
            // ignore
          }
          mongodProcess = null;
          reject(err);
        });
    });

  try {
    await attemptStart();
    console.log(`[mongo] Bundled mongod ready at ${uri}`);
    return uri;
  } catch (error) {
    const exitCode = (error as Error & { exitCode?: number | null }).exitCode;
    const message = String((error as Error).message || "");
    const isIncompatible =
      exitCode === 62 ||
      /\bcode\s*62\b/i.test(message) ||
      /incompatible/i.test(message) ||
      /EXIT_NEED_DOWNGRADE/i.test(message);

    if (isIncompatible) {
      quarantineDbPath(dbPath, "exit code 62 / incompatible data files");
      removeStaleLocks(dbPath);
      await attemptStart();
      console.log(
        `[mongo] Bundled mongod ready at ${uri} (fresh dbpath after code-62 recovery)`,
      );
      return uri;
    }

    throw error;
  }
}

/**
 * Memory server uses its own Mongo build — never point it at Tauri/bundled
 * WiredTiger files (that causes exit code 62). Use a sibling folder instead.
 */
async function startMemoryServer(
  preferredDbPath: string,
  port: number,
): Promise<string> {
  const { MongoMemoryServer } = await import("mongodb-memory-server");

  let dbPath = preferredDbPath;
  if (dbPathHasDataFiles(preferredDbPath)) {
    dbPath = path.join(path.dirname(preferredDbPath), "mongodb-memory");
    console.warn(
      `[mongo] Existing WiredTiger data at ${preferredDbPath} — using ${dbPath} for memory-server to avoid exit code 62`,
    );
  }

  fs.mkdirSync(dbPath, { recursive: true });
  removeStaleLocks(dbPath);

  try {
    const server = await MongoMemoryServer.create({
      instance: {
        dbPath,
        port,
        ip: "127.0.0.1",
        storageEngine: "wiredTiger",
      },
    });

    memoryServer = server;
    const uri = server.getUri();
    console.log(`[mongo] Memory server ready at ${uri} (data: ${dbPath})`);
    return uri;
  } catch (error) {
    const message = String((error as Error).message || "");
    if (/\b62\b/.test(message) || /incompatible/i.test(message)) {
      quarantineDbPath(dbPath, "memory-server incompatible data");
      const server = await MongoMemoryServer.create({
        instance: {
          dbPath,
          port,
          ip: "127.0.0.1",
          storageEngine: "wiredTiger",
        },
      });
      memoryServer = server;
      const uri = server.getUri();
      console.log(
        `[mongo] Memory server ready at ${uri} after quarantine (data: ${dbPath})`,
      );
      return uri;
    }
    throw error;
  }
}

/** Start or connect to embedded MongoDB. Returns connection URI. */
export async function startEmbeddedMongo(dbPath: string): Promise<string> {
  if (process.env.VISION365_MONGO_URI) {
    console.log(
      `[mongo] Using external URI: ${process.env.VISION365_MONGO_URI}`,
    );
    return process.env.VISION365_MONGO_URI;
  }

  const port = getEmbeddedMongoPort();
  const uri = `mongodb://127.0.0.1:${port}`;

  if (await isMongoReachable(uri)) {
    console.log(`[mongo] Already running at ${uri}`);
    return uri;
  }

  // Create/download portable mongod under src-tauri/resources/mongodb when missing.
  const mongodPath = await ensureBundledMongod();
  if (mongodPath) {
    return spawnBundledMongod(dbPath, port);
  }

  return startMemoryServer(dbPath, port);
}

async function isMongoReachable(uri: string): Promise<boolean> {
  try {
    const match = uri.match(/:(\d+)(?:\/|$)/);
    const port = match ? Number(match[1]) : getEmbeddedMongoPort();
    await waitForPort(port, 1500);
    return true;
  } catch {
    return false;
  }
}

export async function stopEmbeddedMongo(): Promise<void> {
  if (mongodProcess) {
    mongodProcess.kill();
    mongodProcess = null;
  }
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
}
