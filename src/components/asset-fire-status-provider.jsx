"use client";

import { useEffect } from "react";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/** Poll AssetsList fire status only while panel monitoring is active */
export function AssetFireStatusProvider({ children }) {
  const monitoring = useFirePanelStore((s) => s.monitoring);
  const startPolling = useAssetFireStatusStore((s) => s.startPolling);
  const stopPolling = useAssetFireStatusStore((s) => s.stopPolling);

  useEffect(() => {
    if (monitoring) {
      startPolling();
      // Pull latest F/T as soon as monitoring starts
      useAssetFireStatusStore.getState().syncFromAssetsList();
      return () => stopPolling();
    }
    stopPolling();
  }, [monitoring, startPolling, stopPolling]);

  return children;
}
