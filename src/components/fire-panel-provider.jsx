"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFirePanelStore } from "@/stores/firePanelStore";

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

  return children;
}
