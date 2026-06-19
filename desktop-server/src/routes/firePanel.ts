import { Hono } from "hono";
import {
  connectFirePanel,
  disconnectFirePanel,
  getFirePanelStatus,
  getReadLogs,
  readFirePanel,
  sendFirePanelCommand,
} from "../services/firePanelService";

export function createFirePanelRoutes() {
  const app = new Hono();

  app.post("/connect", async (c) => {
    const body = await c.req.json();
    const host = String(body.host || "").trim();
    const port = Number(body.port || 23);

    if (!host) {
      return c.json({ error: "Host is required" }, 400);
    }

    try {
      await connectFirePanel(host, port);
      return c.json({ connected: true, host, port });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  app.post("/disconnect", (c) => {
    disconnectFirePanel();
    return c.json({ connected: false });
  });

  app.get("/status", (c) => {
    return c.json(getFirePanelStatus());
  });

  app.post("/poll", async (c) => {
    try {
      const panelData = await readFirePanel();
      return c.json(panelData);
    } catch (error) {
      return c.json({ error: (error as Error).message, logs: getReadLogs() }, 500);
    }
  });

  app.post("/command", async (c) => {
    const body = await c.req.json();
    const command = String(body.command || "");

    if (!command.trim()) {
      return c.json({ error: "Command is required" }, 400);
    }

    const timeoutMs = Number(body.timeoutMs) || undefined;

    try {
      const result = await sendFirePanelCommand(command, timeoutMs);
      return c.json(result);
    } catch (error) {
      return c.json({ error: (error as Error).message, logs: getReadLogs() }, 500);
    }
  });

  return app;
}
