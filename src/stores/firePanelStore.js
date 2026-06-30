import { create } from "zustand";
import { apiFetch } from "@/lib/apiClient";

/** Parse API JSON safely — avoids cryptic errors when HTML error pages are returned */
async function parseJsonResponse(res) {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    if (text.trimStart().startsWith("<")) {
      throw new Error(
        "Fire panel API unavailable. Run npm run desktop:dev to start the local server."
      );
    }
    throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
  }
  return res.json();
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
  /** When true, the app keeps retrying telnet until connected (disabled on manual disconnect). */
  autoReconnect: true,

  setHost: (host) => set({ host }),
  setPort: (port) => set({ port }),

  /** Force UI in sync when the server socket is gone. */
  markDisconnected: (errorMessage = "") =>
    set((state) => ({
      connected: false,
      loading: false,
      lastError: errorMessage || state.lastError,
    })),

  /** Retry connect immediately (no delay) until connected or autoReconnect is off. */
  ensureConnected: async () => {
    if (get().connected) return true;
    if (!get().autoReconnect) return false;

    while (!get().connected && get().autoReconnect) {
      await get().syncStatus();
      if (get().connected) return true;

      if (!get().loading) {
        await get().connect();
        if (get().connected) return true;
      }

      // Yield to the event loop without an intentional retry delay
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    return get().connected;
  },

  syncStatus: async () => {
    try {
      const res = await apiFetch("/api/telnet/fire-panel/status");
      if (!res.ok) {
        get().markDisconnected();
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
        });
      } else {
        // Always trust server — do not keep stale "connected" during reconnect attempts
        set({
          connected: false,
          loading: get().loading,
        });
      }
    } catch {
      // API not available yet — no error banner on startup
    }
  },

  connect: async () => {
    const { host, port } = get();
    if (!host.trim()) return { ok: false };

    set({
      loading: true,
      lastError: "",
      rawResponse: "",
      autoReconnect: true,
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
      return { ok: true };
    } catch (error) {
      if (/not connected/i.test(error.message || "")) {
        const connected = await get().ensureConnected();
        if (connected) {
          return get().sendCommand(command);
        }
        get().markDisconnected(error.message);
      }
      set({ loading: false, lastError: error.message || "Failed to send command" });
      return { ok: false };
    }
  },
}));
