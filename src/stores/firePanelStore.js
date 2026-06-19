import { create } from "zustand";
import { apiFetch } from "@/lib/apiClient";

export const POLL_INTERVAL_MS = 5000;
const MAX_LOG_LINES = 300;

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
  monitoring: false,
  panelData: null,
  readLogs: [],
  lastError: "",
  loading: false,
  rawResponse: "",
  pollTimer: null,

  setHost: (host) => set({ host }),
  setPort: (port) => set({ port }),

  syncStatus: async () => {
    try {
      const res = await apiFetch("/api/telnet/fire-panel/status");
      if (!res.ok) return;

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
        // Resume polling if monitoring was active before navigation
        if (get().monitoring) {
          get().startPolling();
        }
      } else if (!get().loading) {
        set({ connected: false });
      }
    } catch {
      // API not available yet — no error banner on startup
    }
  },

  runPoll: async () => {
    if (!get().monitoring) return;

    try {
      const pollRes = await apiFetch("/api/telnet/fire-panel/poll", {
        method: "POST",
      });
      const pollData = await parseJsonResponse(pollRes);
      const updates = {};

      if (pollData.logs) {
        updates.readLogs = pollData.logs.slice(-MAX_LOG_LINES);
      }

      if (pollData.connected === false) {
        get().stopPolling();
        set({
          connected: false,
          monitoring: false,
          lastError: "Panel connection lost",
          ...updates,
        });
        return;
      }

      if (pollRes.ok) {
        set({ panelData: pollData, lastError: "", ...updates });
      } else {
        set({ lastError: pollData.error || "Poll failed", ...updates });
      }
    } catch {
      // keep connection — retry on next interval
    }
  },

  startPolling: () => {
    const { pollTimer, connected, monitoring } = get();
    if (pollTimer || !connected || !monitoring) return;

    get().runPoll();
    const timer = setInterval(() => get().runPoll(), POLL_INTERVAL_MS);
    set({ pollTimer: timer });
  },

  stopPolling: () => {
    const { pollTimer } = get();
    if (pollTimer) clearInterval(pollTimer);
    set({ pollTimer: null });
  },

  startMonitoring: () => {
    if (!get().connected) return { ok: false, error: "Not connected" };

    set({ monitoring: true, lastError: "" });
    get().startPolling();
    return { ok: true };
  },

  stopMonitoring: () => {
    get().stopPolling();
    set({ monitoring: false });
    return { ok: true };
  },

  connect: async () => {
    const { host, port } = get();
    if (!host.trim()) return { ok: false };

    get().stopPolling();

    set({
      loading: true,
      lastError: "",
      rawResponse: "",
      panelData: null,
      readLogs: [],
      monitoring: false,
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
      set({ loading: false, lastError: error.message || "Failed to connect" });
      return { ok: false, error: error.message };
    }
  },

  disconnect: async () => {
    get().stopPolling();
    set({ loading: true, monitoring: false });

    try {
      await apiFetch("/api/telnet/fire-panel/disconnect", { method: "POST" });
      set({
        connected: false,
        rawResponse: "",
        lastError: "",
        panelData: null,
        readLogs: [],
        loading: false,
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

    // Pause monitoring so manual commands are not stuck behind a poll cycle
    const wasMonitoring = get().monitoring;
    get().stopPolling();
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
      if (data.logs) {
        set({ readLogs: data.logs.slice(-MAX_LOG_LINES) });
      }
      if (!res.ok) throw new Error(data.error || "Command failed");

      set({ rawResponse: data.response || "", loading: false });
      if (wasMonitoring) {
        set({ monitoring: true });
        get().startPolling();
      }
      return { ok: true };
    } catch (error) {
      set({ loading: false, lastError: error.message || "Failed to send command" });
      if (wasMonitoring) {
        set({ monitoring: true });
        get().startPolling();
      }
      return { ok: false };
    }
  },
}));
