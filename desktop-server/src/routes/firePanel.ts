import { Hono } from "hono";
import { getStoredPanelAlarmTotals, getStoredPanelState, savePanelStateCounts } from "../services/firePanelAlarmSync";
import {
  connectFirePanel,
  disconnectFirePanel,
  getFirePanelStatusLive,
  sendFirePanelCommand,
  sendFirePanelCommandPriority,
  sendFirePanelCommandStreaming,
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

  app.get("/status", async (c) => {
    return c.json(await getFirePanelStatusLive());
  });

  app.get("/alarm-totals", async (c) => {
    try {
      const totals = await getStoredPanelAlarmTotals();
      return c.json(totals);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  app.get("/panel-state", async (c) => {
    try {
      const state = await getStoredPanelState();
      return c.json(state);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  app.post("/panel-state", async (c) => {
    const body = await c.req.json();
    const totalFire = Number(body.totalFire);
    const totalTrouble = Number(body.totalTrouble);
    const totalSupervisory = Number(body.totalSupervisory);

    if (
      !Number.isFinite(totalFire) ||
      !Number.isFinite(totalTrouble) ||
      !Number.isFinite(totalSupervisory)
    ) {
      return c.json({ error: "totalFire, totalTrouble, and totalSupervisory are required" }, 400);
    }

    try {
      const state = await savePanelStateCounts({
        totalFire,
        totalTrouble,
        totalSupervisory,
      });
      return c.json(state);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  app.post("/command", async (c) => {
    const body = await c.req.json();
    const command = String(body.command || "");

    if (!command.trim()) {
      return c.json({ error: "Command is required" }, 400);
    }

    const timeoutMs = Number(body.timeoutMs) || undefined;
    // Number(null)===0 — only accept positive CVAL counts.
    const expectedRaw = body.expectedCount;
    const expectedCount =
      expectedRaw == null || expectedRaw === ""
        ? undefined
        : Number.isFinite(Number(expectedRaw)) && Number(expectedRaw) > 0
          ? Number(expectedRaw)
          : undefined;

    try {
      const result = await sendFirePanelCommand(command, timeoutMs, expectedCount);
      return c.json(result);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  // Priority command — jumps ahead of any queued list/CVAL work in the panel worker.
  // Use for ack/silence only so normal monitoring is not disrupted.
  app.post("/command/priority", async (c) => {
    const body = await c.req.json();
    const command = String(body.command || "");

    if (!command.trim()) {
      return c.json({ error: "Command is required" }, 400);
    }

    // Default 5s — enough for ack/silence; caller can override.
    const timeoutMs = Number(body.timeoutMs) > 0 ? Number(body.timeoutMs) : 5000;

    try {
      const result = await sendFirePanelCommandPriority(command, timeoutMs);
      return c.json(result);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  app.post("/command/stream", async (c) => {
    const body = await c.req.json();
    const command = String(body.command || "");

    if (!command.trim()) {
      return c.json({ error: "Command is required" }, 400);
    }

    const timeoutMs = Number(body.timeoutMs) || undefined;
    // Number(null)===0 — only accept positive CVAL counts.
    const expectedRaw = body.expectedCount;
    const expectedCount =
      expectedRaw == null || expectedRaw === ""
        ? undefined
        : Number.isFinite(Number(expectedRaw)) && Number(expectedRaw) > 0
          ? Number(expectedRaw)
          : undefined;
    const encoder = new TextEncoder();

    // Shared so cancel() and late worker chunks cannot crash the process
    // with "Controller is already closed".
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const safeEnqueue = (payload: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(
              encoder.encode(`${JSON.stringify(payload)}\n`),
            );
          } catch {
            closed = true;
          }
        };

        const closeStream = () => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already closed by client cancel or prior done chunk
          }
        };

        try {
          await sendFirePanelCommandStreaming(
            command,
            timeoutMs,
            (response, done) => {
              safeEnqueue({ response, done });
              if (done) closeStream();
            },
            expectedCount,
          );
          closeStream();
        } catch (error) {
          safeEnqueue({
            error: (error as Error).message,
            done: true,
          });
          closeStream();
        }
      },
      cancel() {
        // Client disconnected / aborted — ignore any remaining chunks.
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  });

  return app;
}
