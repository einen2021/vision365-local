/**
 * Starts embedded MongoDB for offline desktop use.
 * - Production: Tauri spawns bundled mongod and sets VISION365_MONGO_URI
 * - Dev fallback: spawns bundled mongod or downloads via mongodb-memory-server
 */

import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import net from "net";

const DEFAULT_PORT = 47820;

let mongodProcess: ChildProcess | null = null;
let memoryServer: {
  stop: () => Promise<boolean>;
  getUri: () => string;
} | null = null;

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

async function spawnBundledMongod(
  dbPath: string,
  port: number,
): Promise<string> {
  const mongodPath = resolveMongodPath();
  if (!mongodPath) {
    throw new Error("Bundled mongod binary not found");
  }

  fs.mkdirSync(dbPath, { recursive: true });

  let exitCode: number | null = null;
  mongodProcess = spawn(
    mongodPath,
    ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  mongodProcess.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[mongod] ${line}`);
  });

  mongodProcess.on("error", (err) => {
    console.error("[mongod] Process error:", err.message);
  });

  mongodProcess.on("exit", (code) => {
    exitCode = code;
    if (code != null && code !== 0) {
      console.error(`[mongod] exited with code ${code}`);
    }
  });

  const uri = `mongodb://127.0.0.1:${port}`;
  try {
    await waitForPort(port, 60000);
  } catch (err) {
    // Exit 62 = data files incompatible with this mongod version.
    // Quarantine the folder and retry once with a fresh dbpath.
    const code =
      exitCode ?? (await waitBrieflyForExitCode(mongodProcess, 2000));
    if (code === 62) {
      console.warn(
        `[mongo] dbpath incompatible with bundled mongod (exit 62). ` +
          `Moving old data aside and starting fresh: ${dbPath}`,
      );
      // Make sure the failed process released WiredTiger file locks.
      if (mongodProcess && !mongodProcess.killed) {
        try {
          mongodProcess.kill();
        } catch {
          // ignore
        }
      }
      await waitBrieflyForExitCode(mongodProcess, 3000);
      mongodProcess = null;
      quarantineDbPath(dbPath);
      fs.mkdirSync(dbPath, { recursive: true });
      return spawnBundledMongodFresh(mongodPath, dbPath, port);
    }
    throw err;
  }

  console.log(`[mongo] Bundled mongod ready at ${uri}`);
  return uri;
}

function quarantineDbPath(dbPath: string) {
  if (!fs.existsSync(dbPath)) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = `${dbPath}-incompatible-${stamp}`;
  try {
    fs.renameSync(dbPath, dest);
    console.warn(`[mongo] Quarantined incompatible data → ${dest}`);
    return;
  } catch (error) {
    console.warn(
      `[mongo] Rename failed (${(error as Error).message}); clearing files instead`,
    );
  }

  // Windows often locks WiredTiger files briefly after mongod exits — clear in place.
  try {
    for (const entry of fs.readdirSync(dbPath)) {
      fs.rmSync(path.join(dbPath, entry), { recursive: true, force: true });
    }
    console.warn(`[mongo] Cleared incompatible files in ${dbPath}`);
  } catch (error) {
    console.warn(
      `[mongo] Could not clear ${dbPath}: ${(error as Error).message}`,
    );
  }
}

function waitBrieflyForExitCode(
  child: ChildProcess | null,
  timeoutMs: number,
): Promise<number | null> {
  if (!child) return Promise.resolve(null);
  if (child.exitCode != null) return Promise.resolve(child.exitCode);

  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(child.exitCode), timeoutMs);
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

/** Second attempt after quarantine — do not recurse on another code 62. */
async function spawnBundledMongodFresh(
  mongodPath: string,
  dbPath: string,
  port: number,
): Promise<string> {
  if (mongodProcess && !mongodProcess.killed) {
    try {
      mongodProcess.kill();
    } catch {
      // ignore
    }
    mongodProcess = null;
  }

  mongodProcess = spawn(
    mongodPath,
    ["--dbpath", dbPath, "--port", String(port), "--bind_ip", "127.0.0.1"],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );

  mongodProcess.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log(`[mongod] ${line}`);
  });

  const uri = `mongodb://127.0.0.1:${port}`;
  await waitForPort(port, 60000);
  console.log(`[mongo] Bundled mongod ready at ${uri} (fresh dbpath)`);
  return uri;
}

async function startMemoryServer(
  dbPath: string,
  port: number,
): Promise<string> {
  const { MongoMemoryServer } = await import("mongodb-memory-server");

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

  if (resolveMongodPath()) {
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
