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
      return () => stopPolling();
    }
    stopPolling();
  }, [monitoring, startPolling, stopPolling]);

  return children;
}
