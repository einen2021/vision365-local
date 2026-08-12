/**
 * Vision365 Local API Server
 * Offline backend for the Tauri desktop application (SQLite).
 */

import fs from "fs";
import path from "path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { connectSqlite, closeDatabase, getSqliteFilePath } from "./db/client";
import { runMigrations } from "./db/migrate";
import { seedIfEmpty, restoreFromBackupIfEmpty } from "./db/seed";
import {
  resolveAppDataPath,
  initAppDirectories,
  importLegacyAppDataAssets,
  listVision365AppDataRoots,
} from "./services/storageService";
import { loadSettings } from "./services/settingsService";
import { initServerLog, serverLog, serverLogError } from "./log";
import dbRoutes from "./routes/db";
import { createUploadRoutes } from "./routes/upload";
import { createBuildingsRoutes } from "./routes/buildings";
import authRoutes from "./routes/auth";
import { createBackupRoutes } from "./routes/backup";
import { createExportRoutes } from "./routes/export";
import { createSettingsRoutes } from "./routes/settings";
import { createFirePanelRoutes } from "./routes/firePanel";
import { shutdownFirePanelWorkers } from "./services/firePanelService";

const HOST = "127.0.0.1";
const PORT = Number(process.env.VISION365_PORT || 47821);

function writePortFile(appDataPath: string, port: number) {
  const portFile = path.join(appDataPath, "server-port.json");
  fs.writeFileSync(
    portFile,
    JSON.stringify({ port, host: HOST, at: new Date().toISOString() }),
  );
}

async function main() {
  const appDataPath = resolveAppDataPath();
  const paths = initAppDirectories(appDataPath);

  // Before DB init: copy floor-plans, uploads, settings, and JSON snapshots
  // from Roaming/Local com.vision365-desktop (and other known AppData roots).
  const legacy = importLegacyAppDataAssets(appDataPath);
  initServerLog(paths.logs);

  serverLog(`App data: ${appDataPath}`);
  serverLog(`SQLite file: ${paths.sqliteFile}`);
  serverLog(`Floor plans: ${paths.floorPlans}`);
  serverLog(
    `Legacy AppData roots scanned: ${listVision365AppDataRoots().length} ` +
      `(floorPlans=+${legacy.floorPlans}, uploads=+${legacy.uploads}, snapshots=+${legacy.snapshots})`,
  );
  serverLog(`Seed path: ${process.env.VISION365_SEED_PATH || "(built-in defaults)"}`);
  serverLog(`Port: ${PORT}`);
  serverLog(`CWD: ${process.cwd()}`);
  serverLog(`Node: ${process.version}`);

  process.env.VISION365_APP_DATA = appDataPath;

  try {
    fs.mkdirSync(paths.database, { recursive: true });
    fs.accessSync(paths.database, fs.constants.W_OK);
    serverLog("Database directory is writable");
  } catch (err) {
    serverLogError(`Cannot write to database directory: ${(err as Error).message}`);
    throw err;
  }

  try {
    connectSqlite(paths.database);
    serverLog(`SQLite connected: ${getSqliteFilePath()}`);
  } catch (err) {
    serverLogError(`SQLite connect failed: ${(err as Error).message}`);
    throw err;
  }

  runMigrations();
  serverLog("Migrations complete");

  // Seeds / restores from JSON backups under AppData when SQLite is empty.
  await seedIfEmpty(appDataPath);
  serverLog("Seed complete");

  try {
    const restored = await restoreFromBackupIfEmpty(appDataPath);
    if (restored) serverLog("Restored database from JSON snapshot backup");
  } catch (error) {
    serverLogError(`Backup restore check failed: ${(error as Error).message}`);
  }

  // After seed/restore: merge any remaining media from other AppData roots.
  const afterSeed = importLegacyAppDataAssets(appDataPath);
  if (afterSeed.floorPlans > 0 || afterSeed.uploads > 0) {
    serverLog(
      `Post-seed media merge: floorPlans=+${afterSeed.floorPlans}, uploads=+${afterSeed.uploads}`,
    );
  }

  loadSettings(paths);

  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: "*",
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      appData: appDataPath,
      version: "0.1.0",
      db: getSqliteFilePath(),
      engine: "sqlite",
    }),
  );

  app.route("/api/db", dbRoutes);
  app.route("/api/upload", createUploadRoutes(paths));
  app.route("/api", createBuildingsRoutes());
  app.route("/", createUploadRoutes(paths));
  app.route("/api/auth", authRoutes);
  app.route("/api/backup", createBackupRoutes(paths));
  app.route("/api/export", createExportRoutes(paths));
  app.route("/api/settings", createSettingsRoutes(paths));
  app.route("/api/telnet/fire-panel", createFirePanelRoutes());

  const server = serve({ fetch: app.fetch, hostname: HOST, port: PORT }, (info) => {
    const actualPort = info.port;
    writePortFile(appDataPath, actualPort);
    process.stdout.write(`VISION365_API_PORT=${actualPort}\n`);
    serverLog(`Running at http://${HOST}:${actualPort}`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      serverLogError(
        `Port ${PORT} is already in use. Another desktop-server may still be running. ` +
          `On Windows: netstat -ano | findstr :${PORT} then taskkill /PID <pid> /F`,
      );
      process.exit(1);
    }
    serverLogError(`Server error: ${err.message}`);
    process.exit(1);
  });

  const shutdown = async () => {
    server.close();
    await shutdownFirePanelWorkers();
    closeDatabase();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    shutdown().catch(() => process.exit(1));
  });
}

main().catch((err) => {
  serverLogError(`Fatal: ${(err as Error).message}`);
  serverLogError(`Stack: ${(err as Error).stack || ""}`);
  process.exit(1);
});
