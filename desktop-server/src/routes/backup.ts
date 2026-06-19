import { Hono } from "hono";
import { type AppPaths } from "../services/storageService";
import { createBackup, restoreBackup, listBackups } from "../services/backupService";

export function createBackupRoutes(paths: AppPaths) {
  const backup = new Hono();

  backup.post("/create", async (c) => {
    try {
      const info = await createBackup(paths);
      return c.json({ success: true, backup: info });
    } catch (error) {
      return c.json({ success: false, error: (error as Error).message }, 500);
    }
  });

  backup.get("/list", (c) => {
    return c.json({ backups: listBackups(paths) });
  });

  backup.post("/restore", async (c) => {
    const { filename } = await c.req.json();
    const result = await restoreBackup(paths, filename);
    return c.json(result, result.success ? 200 : 400);
  });

  return backup;
}
