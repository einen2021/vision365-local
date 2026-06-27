"use client";

import { useEffect, useState } from "react";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/**
 * Start AssetsList simplexStatus live sync only after the floor plan image has loaded.
 * Avoids marker subscriptions and DB polling before the map is ready.
 */
export function useFloorMapAssetStatusLive(imageLoaded) {
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!imageLoaded) {
      setIsLive(false);
      return;
    }

    const store = useAssetFireStatusStore.getState();
    store.subscribeAssetsList();

    let cancelled = false;
    void store.syncFromAssetsList().finally(() => {
      if (!cancelled) setIsLive(true);
    });

    return () => {
      cancelled = true;
      setIsLive(false);
      if (!useAssetFireStatusStore.getState().isPolling) {
        store.unsubscribeAssetsList();
      }
    };
  }, [imageLoaded]);

  return isLive;
}
