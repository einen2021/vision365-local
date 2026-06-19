import { Hono } from "hono";
import { type AppPaths } from "../services/storageService";
import { loadSettings, saveSettings } from "../services/settingsService";

export function createSettingsRoutes(paths: AppPaths) {
  const settings = new Hono();

  settings.get("/", (c) => {
    return c.json({ settings: loadSettings(paths) });
  });

  settings.post("/", async (c) => {
    const { settings: partial } = await c.req.json();
    const merged = await saveSettings(paths, partial);
    return c.json({ settings: merged });
  });

  return settings;
}
