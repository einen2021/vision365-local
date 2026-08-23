import { Hono } from "hono";
import {
  getRecentPanelLogs,
  subscribeToLivePanelLogs,
  logSystemMessage,
  type StoredPanelLog,
} from "../services/firePanelService";

export function createPanelLogRoutes() {
  const app = new Hono();

  /** GET /logs — last N parsed panel log entries (JSON). */
  app.get("/logs", (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit") || 200), 1), 500);
    const kind = c.req.query("kind");
    let rows = getRecentPanelLogs(limit);
    if (kind) rows = rows.filter((r) => r.kind === kind);
    return c.json(rows);
  });

  /** POST /logs — write system/custom log message to saved logs and live stream. */
  app.post("/logs", async (c) => {
    try {
      const body = await c.req.json();
      const message = String(body?.message || body?.raw || "").trim();
      if (!message) return c.json({ ok: false, error: "Message is required" }, 400);

      const stored = logSystemMessage(message);
      return c.json({ ok: true, entry: stored });
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || "Failed to log message" }, 500);
    }
  });

  /** GET /logs/stream — SSE: sends JSON backlog then live events as `data: {...}\n\n`. */
  app.get("/logs/stream", (c) => {
    const encoder = new TextEncoder();
    let closed = false;
    let unsub: (() => void) | null = null;
    let pingTimer: NodeJS.Timeout | null = null;

    const stream = new ReadableStream({
      async start(controller) {
        const safeEnqueue = (payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
            );
          } catch {
            closed = true;
          }
        };

        const safePing = () => {
          if (closed) return;
          try {
            // Standard SSE comment keepalive — prevents proxy/idle timeouts
            controller.enqueue(encoder.encode(": keepalive\n\n"));
          } catch {
            closed = true;
          }
        };

        // 1. Backlog (last 100 rows, oldest first)
        const backlog = getRecentPanelLogs(100);
        for (const entry of backlog) {
          safeEnqueue({ ...entry, backlog: true });
        }

        // 2. Live subscription
        unsub = subscribeToLivePanelLogs((entry: StoredPanelLog) => {
          safeEnqueue(entry);
        });

        // 3. Heartbeat ping every 10s to keep connection alive
        pingTimer = setInterval(safePing, 10000);

        // 4. Handle client disconnect
        c.req.raw.signal.addEventListener("abort", () => {
          closed = true;
          if (pingTimer) clearInterval(pingTimer);
          unsub?.();
          try { controller.close(); } catch { /* already closed */ }
        });
      },
      cancel() {
        closed = true;
        if (pingTimer) clearInterval(pingTimer);
        unsub?.();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });

  return app;
}
