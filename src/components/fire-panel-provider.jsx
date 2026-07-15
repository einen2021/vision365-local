"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFirePanelStore } from "@/stores/firePanelStore";

const STATUS_SYNC_INTERVAL_MS = 8000;
const RECONNECT_INTERVAL_MS = 5000;
const RECONNECT_RETRY_MS = 3000;

/** Keeps fire-panel telnet session alive and retries when offline. */
export function FirePanelProvider({ children }) {
  const syncStatus = useFirePanelStore((s) => s.syncStatus);
  const pathname = usePathname();

  useEffect(() => {
    void syncStatus();
  }, [syncStatus]);

  useEffect(() => {
    void syncStatus();
  }, [pathname, syncStatus]);

  // Poll server socket state while connected.
  useEffect(() => {
    const timer = setInterval(() => {
      void syncStatus();
    }, STATUS_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [syncStatus]);

  // Retry telnet when offline (unless the user clicked Disconnect).
  // IMPORTANT: never exit this loop permanently — autoReconnect can turn
  // back on after a manual Connect, and drops must recover without a refresh.
  useEffect(() => {
    let cancelled = false;

    const reconnectLoop = async () => {
      // Give desktop-server time to finish startup before the first connect.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      while (!cancelled) {
        const state = useFirePanelStore.getState();

        if (state.autoReconnect && !state.connected && !state.loading) {
          try {
            await state.ensureConnected();
          } catch (error) {
            console.warn("[fire-panel] reconnect attempt failed:", error);
          }
        }

        const after = useFirePanelStore.getState();
        const waitMs = after.connected
          ? STATUS_SYNC_INTERVAL_MS
          : after.autoReconnect
            ? RECONNECT_RETRY_MS
            : RECONNECT_INTERVAL_MS;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    };

    void reconnectLoop();

    return () => {
      cancelled = true;
    };
  }, []);

  return children;
}
