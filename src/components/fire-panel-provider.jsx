"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFirePanelStore } from "@/stores/firePanelStore";

const STATUS_SYNC_INTERVAL_MS = 3000;

/** Keeps fire-panel telnet session alive across page navigation. */
export function FirePanelProvider({ children }) {
  const syncStatus = useFirePanelStore((s) => s.syncStatus);
  const pathname = usePathname();

  useEffect(() => {
    syncStatus();
    // Session lives in the desktop server + zustand — never disconnect on route change
  }, [syncStatus]);

  // Re-sync connection state on navigation so monitoring is not interrupted
  useEffect(() => {
    syncStatus();
  }, [pathname, syncStatus]);

  // Keep header status aligned with the desktop-server socket
  useEffect(() => {
    const timer = setInterval(() => {
      void syncStatus();
    }, STATUS_SYNC_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [syncStatus]);

  // Continuously retry telnet until connected (unless user manually disconnected)
  useEffect(() => {
    let cancelled = false;

    const reconnectLoop = async () => {
      while (!cancelled) {
        const state = useFirePanelStore.getState();
        if (!state.autoReconnect) return;

        if (state.connected) {
          await new Promise((resolve) => setTimeout(resolve, STATUS_SYNC_INTERVAL_MS));
          continue;
        }

        await state.ensureConnected();
        if (cancelled) return;

        // Yield without an intentional retry delay when still disconnected
        if (!useFirePanelStore.getState().connected) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    };

    void reconnectLoop();

    return () => {
      cancelled = true;
    };
  }, []);

  return children;
}
