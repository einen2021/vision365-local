import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  cacheChanged,
  FIRE_ACTIVE_ALARM,
  FIRE_ACTIVE_NORMAL,
  FIRE_ACTIVE_TROUBLE,
  indexStatusByAddressKeys,
  indexStatusByAssetIdKeys,
  normalizeDeviceAddress,
  resolveMarkerActive,
} from "@/lib/assetFireStatus";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

export const FIRE_STATUS_POLL_MS = 1000;

let pollTimer = null;
let syncDebounceTimer = null;
let syncInFlight = false;
let syncQueued = false;
let assetsListUnsubscribe = null;

const SYNC_DEBOUNCE_MS = 400;

function buildCacheFromSnapshot(snapshot) {
  const byDeviceAddress = {};
  const byAssetId = {};
  const metaByAssetId = {};

  const storeMeta = (key, data) => {
    if (!key) return;
    const resolvedAddress = resolveAssetDeviceAddress(data);
    metaByAssetId[key] = {
      deviceLocation: String(data.deviceLocation || data.description || "").trim(),
      deviceAddress: resolvedAddress,
    };
  };

  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const status = {
      F: Number(data?.simplexStatus?.F ?? 0),
      T: Number(data?.simplexStatus?.T ?? 0),
      S: Number(data?.simplexStatus?.S ?? 0),
    };
    const resolvedAddress = resolveAssetDeviceAddress(data) || data.deviceAddress || "";

    indexStatusByAddressKeys(byDeviceAddress, resolvedAddress, status);
    if (data.deviceAddress && data.deviceAddress !== resolvedAddress) {
      indexStatusByAddressKeys(byDeviceAddress, data.deviceAddress, status);
    }

    indexStatusByAssetIdKeys(byAssetId, docSnap.id, status);
    storeMeta(docSnap.id, data);

    if (data.assetId) {
      indexStatusByAssetIdKeys(byAssetId, data.assetId, status);
      storeMeta(String(data.assetId), data);
    }
    if (data.buildingAssetId) {
      indexStatusByAssetIdKeys(byAssetId, data.buildingAssetId, status);
      storeMeta(String(data.buildingAssetId), data);
    }
    if (data.assetsListId) {
      indexStatusByAssetIdKeys(byAssetId, data.assetsListId, status);
    }
  });

  return { byDeviceAddress, byAssetId, metaByAssetId };
}

export const useAssetFireStatusStore = create((set, get) => ({
  byDeviceAddress: {},
  byAssetId: {},
  metaByAssetId: {},
  lastSync: null,
  isPolling: false,

  applyAssetsListSnapshot: (snapshot) => {
    const nextCache = buildCacheFromSnapshot(snapshot);
    const prev = get();
    if (!cacheChanged(prev, nextCache)) return;

    set({
      ...nextCache,
      lastSync: Date.now(),
    });
  },

  syncFromAssetsList: async () => {
    if (syncInFlight) {
      syncQueued = true;
      return;
    }
    syncInFlight = true;
    try {
      const snapshot = await getDocs(collection(db, "AssetsList"));
      get().applyAssetsListSnapshot(snapshot);
    } catch (error) {
      console.warn("[assetFireStatus] sync failed:", error);
    } finally {
      syncInFlight = false;
      if (syncQueued) {
        syncQueued = false;
        void get().syncFromAssetsList();
      }
    }
  },

  /** Debounced sync — batches rapid monitor updates into one UI refresh. */
  scheduleSyncFromAssetsList: () => {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => {
      syncDebounceTimer = null;
      void get().syncFromAssetsList();
    }, SYNC_DEBOUNCE_MS);
  },

  subscribeAssetsList: () => {
    if (assetsListUnsubscribe) return assetsListUnsubscribe;

    assetsListUnsubscribe = onSnapshot(
      collection(db, "AssetsList"),
      (snapshot) => {
        get().applyAssetsListSnapshot(snapshot);
      },
      (error) => {
        console.warn("[assetFireStatus] AssetsList listener failed:", error);
      },
    );

    return assetsListUnsubscribe;
  },

  unsubscribeAssetsList: () => {
    if (assetsListUnsubscribe) {
      assetsListUnsubscribe();
      assetsListUnsubscribe = null;
    }
  },

  startPolling: () => {
    if (pollTimer) return;
    set({ isPolling: true });
    get().subscribeAssetsList();
    get().syncFromAssetsList();
    pollTimer = setInterval(() => get().syncFromAssetsList(), FIRE_STATUS_POLL_MS);
  },

  stopPolling: () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    set({ isPolling: false });
  },

  getSimplexStatus: (assetId, deviceAddress) => {
    const { byDeviceAddress, byAssetId } = get();
    const addr = normalizeDeviceAddress(deviceAddress);
    if (addr && byDeviceAddress[addr] !== undefined) return byDeviceAddress[addr];
    if (assetId && byAssetId[assetId] !== undefined) return byAssetId[assetId];
    return null;
  },

  /** @deprecated Use getSimplexStatus — returns F only */
  getFireValue: (assetId, deviceAddress) => {
    const status = get().getSimplexStatus(assetId, deviceAddress);
    if (!status) return null;
    return typeof status === "number" ? status : Number(status.F ?? 0);
  },

  getActiveForAsset: (assetId, deviceAddress, fallback = 0) => {
    return resolveMarkerActive(assetId, deviceAddress, fallback, get());
  },

  getCache: () => ({
    byDeviceAddress: get().byDeviceAddress,
    byAssetId: get().byAssetId,
  }),

  /** Instant UI update after monitor or manual F/T/S change (before next DB poll). */
  patchSimplexStatus: (assetId, deviceAddress, status) => {
    const normalized = {
      F: Number(status?.F ?? 0),
      T: Number(status?.T ?? 0),
      S: Number(status?.S ?? 0),
    };
    set((state) => {
      const byDeviceAddress = { ...state.byDeviceAddress };
      const byAssetId = { ...state.byAssetId };
      indexStatusByAddressKeys(byDeviceAddress, deviceAddress, normalized);
      indexStatusByAssetIdKeys(byAssetId, assetId, normalized);
      return { byDeviceAddress, byAssetId, lastSync: Date.now() };
    });
  },
}));

/** Per-marker subscription — re-renders when this asset's active value changes. */
export function useAssetFireActive(assetId, deviceAddress, fallback = 0, enabled = true) {
  return useAssetFireStatusStore((s) => {
    if (!enabled) {
      const fb = Number(fallback ?? FIRE_ACTIVE_NORMAL);
      if (fb >= FIRE_ACTIVE_ALARM) return FIRE_ACTIVE_ALARM;
      if (fb >= FIRE_ACTIVE_TROUBLE) return FIRE_ACTIVE_TROUBLE;
      return FIRE_ACTIVE_NORMAL;
    }
    void s.lastSync;
    return resolveMarkerActive(assetId, deviceAddress, fallback, s);
  });
}

/** Stable shallow selector — avoids infinite re-render loop */
export function useFireStatusCache() {
  return useAssetFireStatusStore(
    useShallow((s) => ({
      byDeviceAddress: s.byDeviceAddress,
      byAssetId: s.byAssetId,
      metaByAssetId: s.metaByAssetId,
      lastSync: s.lastSync,
    })),
  );
}
