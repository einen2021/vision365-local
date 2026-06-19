"use client";

import { useEffect } from "react";
import { useFirePanelStore } from "@/stores/firePanelStore";

/** Keeps fire-panel telnet session and monitoring alive across page navigation. */
export function FirePanelProvider({ children }) {
  const syncStatus = useFirePanelStore((s) => s.syncStatus);
  const monitoring = useFirePanelStore((s) => s.monitoring);
  const startPolling = useFirePanelStore((s) => s.startPolling);

  useEffect(() => {
    syncStatus();
    // Session lives in the desktop server + zustand — never disconnect on route change
  }, [syncStatus]);

  // Ensure poll timer survives client-side navigation (layout stays mounted)
  useEffect(() => {
    if (monitoring) {
      startPolling();
    }
  }, [monitoring, startPolling]);

  return children;
}
