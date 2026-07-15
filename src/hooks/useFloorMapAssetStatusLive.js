"use client";

import { useEffect, useState } from "react";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/**
 * Keep AssetsList F/T/S sync live after the floor plan image has loaded.
 * Uses both onSnapshot polling and a 1s refresh so marker colors stay in sync.
 */
export function useFloorMapAssetStatusLive(imageLoaded) {
  const [isLive, setIsLive] = useState(false);

  useEffect(() => {
    if (!imageLoaded) {
      setIsLive(false);
      return;
    }

    const store = useAssetFireStatusStore.getState();
    // Use the store immediately — do not wait for the first sync round-trip.
    store.startPolling();
    setIsLive(true);
    void store.syncFromAssetsList();

    return () => {
      setIsLive(false);
      store.stopPolling();
      if (!useAssetFireStatusStore.getState().isPolling) {
        store.unsubscribeAssetsList();
      }
    };
  }, [imageLoaded]);

  return isLive;
}
