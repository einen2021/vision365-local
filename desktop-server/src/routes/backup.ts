import fs from "fs";
import path from "path";
import { Hono } from "hono";
import { type AppPaths } from "../services/storageService";
import { createBackup, restoreBackup, listBackups } from "../services/backupService";
import { readDb, writeDb } from "../db/documentStore";
import {
  countProductiveData,
  findBestDbSnapshotBackup,
  saveDbSnapshotBackup,
} from "../services/dbSnapshotBackup";

export function createBackupRoutes(paths: AppPaths) {
  const backup = new Hono();

  backup.post("/create", async (c) => {
    try {
      // Always refresh the JSON snapshot first (fast, restorable without mongod restart).
      const live = await readDb();
      const jsonPath = saveDbSnapshotBackup(live, paths.root);
      const info = await createBackup(paths);
      return c.json({
        success: true,
        backup: info,
        dbSnapshot: jsonPath
          ? { path: jsonPath, ...countProductiveData(live) }
          : null,
      });
    } catch (error) {
      return c.json({ success: false, error: (error as Error).message }, 500);
    }
  });

  backup.get("/list", (c) => {
    return c.json({ backups: listBackups(paths) });
  });

  backup.get("/db-snapshots", (c) => {
    const dir = path.join(paths.backups, "db-snapshots");
    if (!fs.existsSync(dir)) return c.json({ snapshots: [] });

    const snapshots = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((filename) => {
        const fullPath = path.join(dir, filename);
        const stat = fs.statSync(fullPath);
        return {
          filename,
          path: fullPath,
          size: stat.size,
          createdAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const best = findBestDbSnapshotBackup(paths.root);
    return c.json({
      snapshots,
      best: best
        ? {
            path: best.path,
            score: best.score,
            ...countProductiveData(best.data),
          }
        : null,
    });
  });

  backup.post("/restore-db-snapshot", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const filename = String(body?.filename || "").trim();
      const dir = path.join(paths.backups, "db-snapshots");

      let filePath = "";
      if (filename) {
        filePath = path.join(dir, path.basename(filename));
      } else {
        const best = findBestDbSnapshotBackup(paths.root);
        if (!best) {
          return c.json(
            { success: false, message: "No db snapshot backup found" },
            404,
          );
        }
        filePath = best.path;
      }

      if (!fs.existsSync(filePath)) {
        return c.json({ success: false, message: "Snapshot file not found" }, 404);
      }

      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      const stats = countProductiveData(data);
      if (stats.score === 0) {
        return c.json(
          {
            success: false,
            message: "Snapshot has no communities/assets to restore",
          },
          400,
        );
      }

      const live = await readDb();
      const merged = {
        ...data,
        UserDB: live.UserDB || data.UserDB,
        firePanelState: live.firePanelState || data.firePanelState,
      };
      await writeDb(merged);
      saveDbSnapshotBackup(merged, paths.root);

      return c.json({
        success: true,
        message: "Database restored from JSON snapshot",
        stats,
        path: filePath,
      });
    } catch (error) {
      return c.json({ success: false, error: (error as Error).message }, 500);
    }
  });

  backup.post("/restore", async (c) => {
    const { filename } = await c.req.json();
    const result = await restoreBackup(paths, filename);
    return c.json(result, result.success ? 200 : 400);
  });

  return backup;
}
