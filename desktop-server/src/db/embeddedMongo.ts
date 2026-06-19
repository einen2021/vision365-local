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

  const uri = `mongodb://127.0.0.1:${port}`;
  await waitForPort(port, 60000);
  console.log(`[mongo] Bundled mongod ready at ${uri}`);
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
