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
      } else if (!get().loading) {
        set({ connected: false });
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
    set({ loading: true });

    try {
      await apiFetch("/api/telnet/fire-panel/disconnect", { method: "POST" });
      set({
        connected: false,
        rawResponse: "",
        lastError: "",
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
      if (!res.ok) throw new Error(data.error || "Command failed");

      set({ rawResponse: data.response || "", loading: false });
      return { ok: true };
    } catch (error) {
      set({ loading: false, lastError: error.message || "Failed to send command" });
      return { ok: false };
    }
  },
}));
