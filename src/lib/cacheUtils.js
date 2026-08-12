import { clearAddressFloorDetailsIndex } from "@/lib/assetAddressFloorIndex";
import { invalidateAssetsListSnapshotCache } from "@/lib/floorMapAssets";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/**
 * Clear all in-memory, store, and browser storage caches for asset and floor data.
 */
export async function clearAllAppCaches() {
  // 1. Invalidate AssetsList snapshot cache
  invalidateAssetsListSnapshotCache();

  // 2. Clear Address Floor Details Index (byAddress & byAssetId maps)
  clearAddressFloorDetailsIndex();

  // 3. Reset & resync Asset Fire Status store
  try {
    const store = useAssetFireStatusStore.getState();
    if (store) {
      useAssetFireStatusStore.setState({
        byDeviceAddress: {},
        byAssetId: {},
        metaByAssetId: {},
        panelLiveByAddress: {},
        showStatusByAddress: {},
      });
      if (typeof store.syncFromAssetsList === "function") {
        await store.syncFromAssetsList();
      }
    }
  } catch (err) {
    console.warn("[clearAllAppCaches] store reset warning:", err);
  }

  // 4. Clear any local / session storage caches
  try {
    if (typeof window !== "undefined") {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes("cache") || key.includes("asset") || key.includes("floor") || key.includes("simplex"))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));

      const sessionKeysToRemove = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.includes("cache") || key.includes("asset") || key.includes("floor") || key.includes("simplex"))) {
          sessionKeysToRemove.push(key);
        }
      }
      sessionKeysToRemove.forEach((k) => sessionStorage.removeItem(k));
    }
  } catch (err) {
    console.warn("[clearAllAppCaches] storage cleanup warning:", err);
  }

  return { success: true, timestamp: Date.now() };
}
