import { create } from "zustand";
import { apiFetch, parseApiJsonResponse } from "@/lib/apiClient";

/** Parse API JSON safely — avoids cryptic errors when HTML error pages are returned */
async function parseJsonResponse(res) {
  return parseApiJsonResponse(res);
}

export const useFirePanelStore = create((set, get) => ({
  host: "192.168.100.1",
  port: "23",
  connected: false,
  connectedHost: "",
  connectedPort: 23,
  connectedAt: null,
  lastError: "",
  loading: false,
  rawResponse: "",
  /** When true, the app retries telnet until connected (disabled on manual disconnect). */
  autoReconnect: true,
  /** Consecutive /status polls that reported disconnected before UI drops to offline. */
  disconnectStreak: 0,

  setHost: (host) => set({ host }),
  setPort: (port) => set({ port }),

  /** Force UI in sync when the server socket is gone. */
  markDisconnected: (errorMessage = "") =>
    set((state) => ({
      connected: false,
      loading: false,
      lastError: errorMessage || state.lastError,
    })),

  /** Sync status, then connect once if still offline and auto-reconnect is enabled. */
  ensureConnected: async () => {
    // Don't block reconnect forever if a previous command left loading stuck.
    if (get().loading) {
      const started = Date.now();
      while (get().loading && Date.now() - started < 4000) {
        await new Promise((r) => setTimeout(r, 200));
      }
      if (get().loading) {
        set({ loading: false });
      }
    }

    await get().syncStatus();
    if (get().connected) return true;
    if (!get().autoReconnect) return false;

    const result = await get().connect();
    return Boolean(result?.ok) || get().connected;
  },

  syncStatus: async () => {
    try {
      const res = await apiFetch("/api/telnet/fire-panel/status");
      if (!res.ok) {
        // Proxy/API hiccups must not drop a live telnet session in the UI
        if (res.status === 404 || res.status === 502 || res.status === 503) return;
        return;
      }

      const status = await parseJsonResponse(res);
      if (status.connected) {
        set({
          connected: true,
          connectedHost: status.host,
          connectedPort: status.port,
          host: status.host || get().host,
          port: status.port ? String(status.port) : get().port,
          lastError: "",
          disconnectStreak: 0,
          loading: false,
        });
        return;
      }

      const wasConnected = get().connected;
      const nextStreak = (get().disconnectStreak || 0) + 1;
      // Require two consecutive offline polls before flipping the header badge.
      if (wasConnected && nextStreak < 2) {
        set({ disconnectStreak: nextStreak });
        return;
      }

      set({
        connected: false,
        loading: false,
        disconnectStreak: nextStreak,
        lastError: wasConnected
          ? get().lastError || "Telnet session ended"
          : get().lastError,
      });
    } catch {
      // API not available yet — keep current connection state
    }
  },

  connect: async () => {
    const { host, port } = get();
    if (!host.trim()) return { ok: false };
    if (get().loading) return { ok: false, reason: "in_progress" };

    await get().syncStatus();
    if (get().connected) {
      return { ok: true, alreadyConnected: true };
    }

    set({
      loading: true,
      lastError: "",
      rawResponse: "",
      autoReconnect: true,
      disconnectStreak: 0,
    });

    try {
      const numericPort = Number(port) || 23;
      const res = await apiFetch("/api/telnet/fire-panel/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ host: host.trim(), port: numericPort }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) throw new Error(data.error || "Connect failed");

      set({
        connected: true,
        connectedHost: host.trim(),
        connectedPort: numericPort,
        connectedAt: new Date().toISOString(),
        loading: false,
        lastError: "",
        disconnectStreak: 0,
      });
      return { ok: true };
    } catch (error) {
      set({
        connected: false,
        loading: false,
        lastError: error.message || "Failed to connect",
      });
      return { ok: false, error: error.message };
    }
  },

  disconnect: async () => {
    set({ loading: true, autoReconnect: false });

    try {
      await apiFetch("/api/telnet/fire-panel/disconnect", { method: "POST" });
      set({
        connected: false,
        rawResponse: "",
        lastError: "",
        loading: false,
        autoReconnect: false,
        disconnectStreak: 0,
      });
      return { ok: true };
    } catch (error) {
      set({ loading: false, lastError: error.message || "Failed to disconnect" });
      return { ok: false };
    }
  },

  sendCommand: async (command) => {
    const trimmed = command.trim();
    if (!trimmed) return { ok: false };

    set({ loading: true, lastError: "" });

    const lower = trimmed.toLowerCase();
    const timeoutMs =
      lower.includes("cshow *") || lower.includes("cshow*")
        ? 60000
        : lower.startsWith("list")
          ? 15000
        : lower.startsWith("show")
          ? 8000
          : lower.includes("cval")
            ? 3000
            : 5000;

    try {
      const res = await apiFetch("/api/telnet/fire-panel/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: trimmed, timeoutMs }),
      });
      const data = await parseJsonResponse(res);
      if (!res.ok) {
        const message = data.error || "Command failed";
        if (/not connected/i.test(message)) {
          get().markDisconnected(message);
          throw new Error(message);
        }
        throw new Error(message);
      }

      set({ rawResponse: data.response || "", loading: false });
      return { ok: true, response: data.response || "" };
    } catch (error) {
      if (/not connected/i.test(error.message || "")) {
        await get().syncStatus();
        if (get().connected) {
          return get().sendCommand(command);
        }
        get().markDisconnected(error.message);
      }
      set({ loading: false, lastError: error.message || "Failed to send command" });
      return { ok: false };
    }
  },
}));
