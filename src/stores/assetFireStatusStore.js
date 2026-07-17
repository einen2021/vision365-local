import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { collection, getDocs, onSnapshot } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  cacheChanged,
  collectDeviceAddressKeys,
  FIRE_ACTIVE_ALARM,
  FIRE_ACTIVE_NORMAL,
  FIRE_ACTIVE_TROUBLE,
  indexStatusByAddressKeys,
  indexStatusByAssetIdKeys,
  markerVisualFromFT,
  normalizeSimplexStatus,
  resolveMarkerActive,
  resolveMarkerActiveFromMapping,
  resolveMarkerStatusFromMapping,
} from "@/lib/assetFireStatus";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";
import { invalidateAssetsListSnapshotCache } from "@/lib/floorMapAssets";

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
      deviceLocation: String(data.deviceLocation || "").trim(),
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
  // Live panel list flags (F/T/S) keyed by address — survives AssetsList poll.
  panelLiveByAddress: {},
  /** Asset Control `show` status — lowest priority vs monitor + AssetsList. */
  showStatusByAddress: {},
  lastSync: null,
  isPolling: false,

  applyAssetsListSnapshot: (snapshot) => {
    const nextCache = buildCacheFromSnapshot(snapshot);
    const prev = get();
    // Keep AssetsList maps pure. Panel live flags live in panelLiveByAddress
    // and are OR'd at resolve time so polls cannot wipe optimistic F/T.
    if (!cacheChanged(prev, nextCache)) return;

    set({
      ...nextCache,
      panelLiveByAddress: prev.panelLiveByAddress,
      showStatusByAddress: prev.showStatusByAddress,
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
      // Never reuse the placement/search snapshot cache for live F/T colors.
      invalidateAssetsListSnapshotCache();
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
    const { byDeviceAddress, byAssetId, panelLiveByAddress } = get();
    // Inline the same OR resolve path markers use.
    const addressKeys = collectDeviceAddressKeys(deviceAddress);
    let fromList = null;
    for (const addr of addressKeys) {
      if (byDeviceAddress[addr] !== undefined) {
        fromList = normalizeSimplexStatus(byDeviceAddress[addr]);
        break;
      }
    }
    if (!fromList && assetId && byAssetId[assetId] !== undefined) {
      fromList = normalizeSimplexStatus(byAssetId[assetId]);
    }
    let fromPanel = null;
    for (const addr of addressKeys) {
      if (panelLiveByAddress[addr] !== undefined) {
        fromPanel = normalizeSimplexStatus(panelLiveByAddress[addr]);
        break;
      }
    }
    if (!fromList && !fromPanel) return null;
    if (!fromList) return fromPanel;
    if (!fromPanel) return fromList;
    return {
      F: fromList.F === 1 || fromPanel.F === 1 ? 1 : 0,
      T: fromList.T === 1 || fromPanel.T === 1 ? 1 : 0,
      S: fromList.S === 1 || fromPanel.S === 1 ? 1 : 0,
    };
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

  /**
   * Turn markers red/yellow as soon as list output names a device address,
   * before AssetsList writes finish. Stored in panelLiveByAddress so the 1s
   * AssetsList poll cannot overwrite live F/T with stale zeros.
   */
  /**
   * Store `show` PRIMARY STATUS for a device (lowest marker priority).
   * Used when monitor list has not synced this address yet.
   */
  patchShowStatusForAddress: (deviceAddress, status) => {
    const normalized = normalizeSimplexStatus(status);
    set((state) => {
      const showStatusByAddress = { ...state.showStatusByAddress };
      let changed = false;
      for (const addrKey of collectDeviceAddressKeys(deviceAddress)) {
        const prev = normalizeSimplexStatus(showStatusByAddress[addrKey]);
        if (
          prev.F === normalized.F &&
          prev.T === normalized.T &&
          prev.S === normalized.S
        ) {
          continue;
        }
        showStatusByAddress[addrKey] = { ...normalized };
        changed = true;
      }
      if (!changed) return state;
      return { showStatusByAddress, lastSync: Date.now() };
    });
  },

  optimisticallySetFlagForAddresses: (addresses = [], statusKey, value = 1) => {
    if (!["F", "T", "S"].includes(statusKey)) return;

    set((state) => {
      const panelLiveByAddress = { ...state.panelLiveByAddress };
      let changed = false;

      for (const address of addresses) {
        for (const addrKey of collectDeviceAddressKeys(address)) {
          const current = normalizeSimplexStatus(panelLiveByAddress[addrKey]);
          if (Number(current[statusKey]) === value) continue;
          panelLiveByAddress[addrKey] = { ...current, [statusKey]: value };
          changed = true;
        }
      }

      if (!changed) return state;
      return { panelLiveByAddress, lastSync: Date.now() };
    });
  },

  /**
   * Replace one category (F/T/S) from a full panel list:
   * active addresses → 1, previously active addresses not in the list → 0.
   */
  syncPanelLiveFlagsForCategory: (statusKey, activeAddresses = []) => {
    if (!["F", "T", "S"].includes(statusKey)) return;

    set((state) => {
      const panelLiveByAddress = { ...state.panelLiveByAddress };
      const activeKeys = new Set();

      for (const address of activeAddresses) {
        for (const addrKey of collectDeviceAddressKeys(address)) {
          activeKeys.add(addrKey);
        }
      }

      let changed = false;

      for (const addrKey of activeKeys) {
        const current = normalizeSimplexStatus(panelLiveByAddress[addrKey]);
        if (Number(current[statusKey]) === 1) continue;
        panelLiveByAddress[addrKey] = { ...current, [statusKey]: 1 };
        changed = true;
      }

      for (const [addrKey, status] of Object.entries(panelLiveByAddress)) {
        const current = normalizeSimplexStatus(status);
        if (Number(current[statusKey]) !== 1) continue;
        if (activeKeys.has(addrKey)) continue;
        panelLiveByAddress[addrKey] = { ...current, [statusKey]: 0 };
        changed = true;
      }

      if (!changed) return state;
      return { panelLiveByAddress, lastSync: Date.now() };
    });
  },

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
      const panelLiveByAddress = { ...state.panelLiveByAddress };
      indexStatusByAddressKeys(byDeviceAddress, deviceAddress, normalized);
      indexStatusByAssetIdKeys(byAssetId, assetId, normalized);
      for (const addrKey of collectDeviceAddressKeys(deviceAddress)) {
        panelLiveByAddress[addrKey] = { ...normalized };
      }
      return {
        byDeviceAddress,
        byAssetId,
        panelLiveByAddress,
        lastSync: Date.now(),
      };
    });
  },

  /** Patch every cache key tied to an AssetsList row (doc id, building asset id, etc.). */
  patchSimplexStatusFromEntry: (entryId, data, status, extraAddress = "") => {
    const normalized = {
      F: Number(status?.F ?? 0),
      T: Number(status?.T ?? 0),
      S: Number(status?.S ?? 0),
    };
    set((state) => {
      const byDeviceAddress = { ...state.byDeviceAddress };
      const byAssetId = { ...state.byAssetId };
      const panelLiveByAddress = { ...state.panelLiveByAddress };
      const resolvedAddress = resolveAssetDeviceAddress(data) || data.deviceAddress || "";

      indexStatusByAddressKeys(byDeviceAddress, resolvedAddress, normalized);
      if (data.deviceAddress && data.deviceAddress !== resolvedAddress) {
        indexStatusByAddressKeys(byDeviceAddress, data.deviceAddress, normalized);
      }
      if (extraAddress) {
        indexStatusByAddressKeys(byDeviceAddress, extraAddress, normalized);
      }

      for (const address of [resolvedAddress, data.deviceAddress, extraAddress]) {
        for (const addrKey of collectDeviceAddressKeys(address)) {
          panelLiveByAddress[addrKey] = { ...normalized };
        }
      }

      indexStatusByAssetIdKeys(byAssetId, entryId, normalized);
      if (data.assetId) indexStatusByAssetIdKeys(byAssetId, data.assetId, normalized);
      if (data.buildingAssetId) {
        indexStatusByAssetIdKeys(byAssetId, data.buildingAssetId, normalized);
      }
      if (data.assetsListId) indexStatusByAssetIdKeys(byAssetId, data.assetsListId, normalized);
      if (data.id) indexStatusByAssetIdKeys(byAssetId, data.id, normalized);

      return {
        byDeviceAddress,
        byAssetId,
        panelLiveByAddress,
        showStatusByAddress: state.showStatusByAddress,
        lastSync: Date.now(),
      };
    });
  },

  /** Clear all cached F/T/S values so markers return to green immediately. */
  clearAllSimplexStatusInStore: () => {
    set((state) => {
      const cleared = { F: 0, T: 0, S: 0 };
      const byDeviceAddress = {};
      const byAssetId = {};
      const panelLiveByAddress = {};
      const showStatusByAddress = {};

      for (const key of Object.keys(state.byDeviceAddress)) {
        byDeviceAddress[key] = cleared;
      }
      for (const key of Object.keys(state.byAssetId)) {
        byAssetId[key] = cleared;
      }
      for (const key of Object.keys(state.panelLiveByAddress)) {
        panelLiveByAddress[key] = cleared;
      }
      for (const key of Object.keys(state.showStatusByAddress || {})) {
        showStatusByAddress[key] = cleared;
      }

      return {
        byDeviceAddress,
        byAssetId,
        panelLiveByAddress,
        showStatusByAddress,
        lastSync: Date.now(),
      };
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

/**
 * Prefer mapping fields (assetsListId, buildingAssetId, nested address)
 * so floor-plan markers update even when placement doc id ≠ AssetsList id.
 */
export function useAssetFireActiveFromMapping(
  mapping,
  deviceAddress,
  fallback = 0,
  enabled = true,
) {
  return useAssetFireStatusStore((s) => {
    if (!enabled) {
      const fb = Number(fallback ?? FIRE_ACTIVE_NORMAL);
      if (fb >= FIRE_ACTIVE_ALARM) return FIRE_ACTIVE_ALARM;
      if (fb >= FIRE_ACTIVE_TROUBLE) return FIRE_ACTIVE_TROUBLE;
      return FIRE_ACTIVE_NORMAL;
    }
    void s.lastSync;
    return resolveMarkerActiveFromMapping(mapping, deviceAddress, fallback, s);
  });
}

/**
 * Live F/T + visual style for a floor-map marker.
 * F=1 → red + ripple; F=0 T=1 → yellow; F=0 T=0 → green.
 */
export function useAssetMarkerVisualFromMapping(
  mapping,
  deviceAddress,
  fallback = 0,
  enabled = true,
) {
  // Subscribe only to F:T so we do not return a new object every render.
  const ftKey = useAssetFireStatusStore((s) => {
    void s.lastSync;
    if (!enabled) {
      const fb = Number(fallback ?? FIRE_ACTIVE_NORMAL);
      if (fb >= FIRE_ACTIVE_ALARM) return "1:0";
      if (fb >= FIRE_ACTIVE_TROUBLE) return "0:1";
      return "0:0";
    }
    const status = resolveMarkerStatusFromMapping(
      mapping,
      deviceAddress,
      fallback,
      s,
    );
    return `${status.F}:${status.T}`;
  });

  const [fPart, tPart] = String(ftKey || "0:0").split(":");
  return markerVisualFromFT(Number(fPart), Number(tPart));
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
