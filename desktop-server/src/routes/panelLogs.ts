import { Hono } from "hono";
import {
  getRecentPanelLogs,
  subscribeToLivePanelLogs,
  logSystemMessage,
  clearPanelLogs,
  type StoredPanelLog,
} from "../services/firePanelService";

async function resolveUserRole(c: any): Promise<string> {
  const roleHeader = c.req.header("x-user-role") || c.req.query("role");
  if (roleHeader) return String(roleHeader).trim().toLowerCase();

  try {
    const cloned = c.req.raw.clone();
    const body = await cloned.json();
    if (body?.role) return String(body.role).trim().toLowerCase();
  } catch {
    // ignore
  }

  const authHeader = c.req.header("Authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    try {
      const { validateSession } = await import("../services/authService");
      const sessionUser = await validateSession(token);
      if (sessionUser?.role) return String(sessionUser.role).trim().toLowerCase();
    } catch {
      // ignore
    }
  }

  return "";
}

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

  /** DELETE /logs — clear previous saved panel logs (admin role required). */
  app.delete("/logs", async (c) => {
    try {
      const role = await resolveUserRole(c);
      if (role !== "admin" && role !== "administrator") {
        return c.json(
          { ok: false, error: "Unauthorized: Admin role is required to clear saved logs" },
          403,
        );
      }

      const result = clearPanelLogs();
      return c.json({ ok: true, deleted: result.deleted });
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || "Failed to clear saved logs" }, 500);
    }
  });

  /** POST /logs/clear — alias for clear previous saved panel logs (admin role required). */
  app.post("/logs/clear", async (c) => {
    try {
      const role = await resolveUserRole(c);
      if (role !== "admin" && role !== "administrator") {
        return c.json(
          { ok: false, error: "Unauthorized: Admin role is required to clear saved logs" },
          403,
        );
      }

      const result = clearPanelLogs();
      return c.json({ ok: true, deleted: result.deleted });
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || "Failed to clear saved logs" }, 500);
    }
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

  /** POST /simulate — simulate live fire, trouble, or supervisory event (debug/demo mode). */
  app.post("/simulate", async (c) => {
    try {
      const body = await c.req.json();
      const type = String(body?.type || body?.kind || "trouble").toLowerCase();
      const raw = String(body?.raw || "").trim();
      const location = String(body?.location || "SUB BS CRDR COS 21 SB/L1/2").trim();
      const device = String(
        body?.device ||
          (type === "fire"
            ? "PULL STATION"
            : type === "supervisory"
              ? "SUPERVISORY MONITOR"
              : "PULL STATION"),
      ).trim();
      const status = String(
        body?.status ||
          (type === "fire"
            ? "FIRE ALARM"
            : type === "supervisory"
              ? "SUPERVISORY"
              : "DISABLE TROUBLE"),
      ).trim();

      const time = String(body?.time || "1:49:24 am").trim();
      const weekday = String(body?.weekday || "WED").trim();
      const date = String(body?.date || "01-JAN-97").trim();

      const defaultRaw = ` 1:49:24 am  WED 01-JAN-97 ${location}\n             ${device}                  ${status} `;
      const rawMessage = raw || defaultRaw;

      const kind =
        type === "fire" ? "fire" : type === "supervisory" ? "supervisory" : "trouble";

      const entry = {
        kind,
        time,
        weekday,
        date,
        location,
        device,
        status,
        raw: rawMessage,
        at: new Date().toISOString(),
      };

      const { simulatePanelLogEntry } = await import("../services/firePanelService");
      const stored = simulatePanelLogEntry(entry as any);
      return c.json({ ok: true, entry: stored });
    } catch (err: any) {
      return c.json({ ok: false, error: err?.message || "Failed to simulate message" }, 500);
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
