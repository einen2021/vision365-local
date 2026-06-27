"use client";

import { useEffect } from "react";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { isFirePanelMonitoringPersisted } from "@/lib/firePanelMonitorSession";

/** One-time AssetsList load on app start. Live sync starts from floor-map pages after image load. */
export function AssetFireStatusProvider({ children }) {
  const syncFromAssetsList = useAssetFireStatusStore((s) => s.syncFromAssetsList);
  const startPolling = useAssetFireStatusStore((s) => s.startPolling);

  useEffect(() => {
    void syncFromAssetsList();
    if (isFirePanelMonitoringPersisted()) {
      startPolling();
    }
  }, [syncFromAssetsList, startPolling]);

  return children;
}
