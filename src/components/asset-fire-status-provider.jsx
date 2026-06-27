"use client";

import { useEffect } from "react";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/** Load AssetsList fire/trouble status once on app start. */
export function AssetFireStatusProvider({ children }) {
  const syncFromAssetsList = useAssetFireStatusStore((s) => s.syncFromAssetsList);

  useEffect(() => {
    void syncFromAssetsList();
  }, [syncFromAssetsList]);

  return children;
}
