"use client";

import { useEffect } from "react";
import { useFirePanelStore } from "@/stores/firePanelStore";

/** Keeps fire-panel telnet session alive across page navigation. */
export function FirePanelProvider({ children }) {
  const syncStatus = useFirePanelStore((s) => s.syncStatus);

  useEffect(() => {
    syncStatus();
    // Session lives in the desktop server + zustand — never disconnect on route change
  }, [syncStatus]);

  return children;
}
