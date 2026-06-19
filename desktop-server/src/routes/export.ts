import { Hono } from "hono";
import { type AppPaths } from "../services/storageService";
import { exportCollection, exportFullDatabase } from "../services/exportService";

export function createExportRoutes(paths: AppPaths) {
  const exportRoutes = new Hono();

  exportRoutes.post("/collection", async (c) => {
    const { collectionPath, format, filename } = await c.req.json();
    const result = await exportCollection(paths, collectionPath, format, filename);
    return c.json({ success: true, export: result });
  });

  exportRoutes.post("/full", async (c) => {
    const { format } = await c.req.json();
    const result = await exportFullDatabase(paths, format || "json");
    return c.json({ success: true, export: result });
  });

  return exportRoutes;
}
