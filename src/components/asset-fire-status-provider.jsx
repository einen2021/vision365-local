"use client";

import { useEffect } from "react";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/** One-time AssetsList load on app start. Live sync starts from floor-map pages after image load. */
export function AssetFireStatusProvider({ children }) {
  const syncFromAssetsList = useAssetFireStatusStore((s) => s.syncFromAssetsList);

  useEffect(() => {
    void syncFromAssetsList();
  }, [syncFromAssetsList]);

  return children;
}
