import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { collection, getDocsMirrored, onSnapshot } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  cacheChanged,
  collectDeviceAddressKeys,
  FIRE_ACTIVE_ALARM,
  FIRE_ACTIVE_NORMAL,
  FIRE_ACTIVE_SUPERVISORY,
  FIRE_ACTIVE_TROUBLE,
  indexStatusByAddressKeys,
  indexStatusByAssetIdKeys,
  markerVisualFromFT,
  markerVisualFromFTS,
  normalizeSimplexStatus,
  resolveMarkerActive,
  resolveMarkerActiveFromMapping,
  resolveMarkerStatusFromMapping,
} from "@/lib/assetFireStatus";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

export const FIRE_STATUS_POLL_MS = 1000;

let pollTimer = null;
let syncDebounceTimer = null;
let syncInFlight = false;
let syncQueued = false;
let assetsListUnsubscribe = null;

const SYNC_DEBOUNCE_MS = 400;
/** Last mirrored AssetsList snapshot applied by syncFromAssetsList (identity check). */
let lastAppliedSnapshot = null;
/** F/T/S per address key exactly as the database last reported it (no live/optimistic flags). */
let lastDbByDeviceAddress = null;

function sameStatus(a, b) {
  const x = normalizeSimplexStatus(a);
  const y = normalizeSimplexStatus(b);
  return x.F === y.F && x.T === y.T && x.S === y.S;
}

function buildCacheFromSnapshot(snapshot) {
  const byDeviceAddress = {};
  const byAssetId = {};
  const metaByAssetId = {};

  const storeMeta = (key, data) => {
    if (!key) return;
    const resolvedAddress = resolveAssetDeviceAddress(data);
    metaByAssetId[key] = {
      deviceLocation: String(
        data.deviceLocation ??
        data.details?.deviceLocation ??
        data.DeviceLocation ??
        ""
      ).trim(),
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

  updateAssetMeta: ({ assetId = "", deviceAddress = "", deviceLocation }) => {
    set((prev) => {
      const nextMeta = { ...prev.metaByAssetId };
      const location = String(deviceLocation || "").trim();
      const address = String(deviceAddress || "").trim();

      const updateKey = (k) => {
        if (!k) return;
        const key = String(k).trim();
        if (!key) return;
        nextMeta[key] = {
          ...nextMeta[key],
          ...(deviceLocation !== undefined ? { deviceLocation: location } : {}),
          ...(address ? { deviceAddress: address } : {}),
        };
      };

      updateKey(assetId);
      updateKey(address);
      return { metaByAssetId: nextMeta };
    });
  },

  applyAssetsListSnapshot: (snapshot) => {
    const nextCache = buildCacheFromSnapshot(snapshot);
    const prev = get();

    // Live panel flags (panelLiveByAddress) win over AssetsList when markers
    // resolve, so a poll cannot undo an instant F/T/S change before its DB
    // write lands. But once a device's F/T/S changes IN THE DATABASE (list
    // sync, reset, restore, server-side sync, another PC), the database is the
    // newer truth: drop that device's live flags so its marker follows the DB.
    const prevDb = lastDbByDeviceAddress;
    lastDbByDeviceAddress = nextCache.byDeviceAddress;
    let panelLiveByAddress = prev.panelLiveByAddress;
    let showStatusByAddress = prev.showStatusByAddress;
    let liveChanged = false;
    if (prevDb) {
      const live = { ...panelLiveByAddress };
      const show = { ...showStatusByAddress };
      for (const [key, status] of Object.entries(nextCache.byDeviceAddress)) {
        if (sameStatus(prevDb[key], status)) continue;
        if (key in live) {
          delete live[key];
          liveChanged = true;
        }
        if (key in show) {
          delete show[key];
          liveChanged = true;
        }
      }
      if (liveChanged) {
        panelLiveByAddress = live;
        showStatusByAddress = show;
      }
    }

    if (!liveChanged && !cacheChanged(prev, nextCache)) return;

    set({
      ...nextCache,
      panelLiveByAddress,
      showStatusByAddress,
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
      // Incremental: only AssetsList docs changed since the last sync are
      // fetched, and an unchanged collection returns the same snapshot object.
      const snapshot = await getDocsMirrored(collection(db, "AssetsList"));
      if (snapshot === lastAppliedSnapshot) return;
      lastAppliedSnapshot = snapshot;
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
      const byDeviceAddress = { ...state.byDeviceAddress };
      let changed = false;

      for (const address of addresses) {
        for (const addrKey of collectDeviceAddressKeys(address)) {
          const current = normalizeSimplexStatus(panelLiveByAddress[addrKey]);
          if (Number(current[statusKey]) !== value) {
            panelLiveByAddress[addrKey] = { ...current, [statusKey]: value };
            changed = true;
          }
          const listCur = normalizeSimplexStatus(byDeviceAddress[addrKey]);
          if (Number(listCur[statusKey]) !== value) {
            byDeviceAddress[addrKey] = { ...listCur, [statusKey]: value };
            changed = true;
          }
        }
      }

      if (!changed) return state;
      return { panelLiveByAddress, byDeviceAddress, lastSync: Date.now() };
    });
  },

  /**
   * Replace one category (F/T/S) from a full panel list:
   * active addresses → 1, previously active addresses not in the list → 0.
  /**
   * Fast in-memory update (in milliseconds) of one category (F/T/S) from a panel list response:
   * active addresses → statusKey=1, excluded addresses (in previous or state but not active) → statusKey=0.
   */
  syncPanelLiveFlagsForCategory: (statusKey, activeAddresses = [], previousAddresses = []) => {
    if (!["F", "T", "S"].includes(statusKey)) return;

    set((state) => {
      const byDeviceAddress = { ...state.byDeviceAddress };
      const byAssetId = { ...state.byAssetId };
      const panelLiveByAddress = { ...state.panelLiveByAddress };
      const showStatusByAddress = { ...state.showStatusByAddress };

      const activeKeys = new Set();
      for (const address of activeAddresses) {
        for (const addrKey of collectDeviceAddressKeys(address)) {
          activeKeys.add(addrKey);
        }
      }

      let changed = false;

      // 1. Set statusKey = 1 for all active/new addresses
      for (const address of activeAddresses) {
        for (const addrKey of collectDeviceAddressKeys(address)) {
          const liveCur = normalizeSimplexStatus(panelLiveByAddress[addrKey]);
          if (Number(liveCur[statusKey]) !== 1) {
            panelLiveByAddress[addrKey] = { ...liveCur, [statusKey]: 1 };
            changed = true;
          }
          const listCur = normalizeSimplexStatus(byDeviceAddress[addrKey]);
          if (Number(listCur[statusKey]) !== 1) {
            byDeviceAddress[addrKey] = { ...listCur, [statusKey]: 1 };
            changed = true;
          }
          if (showStatusByAddress[addrKey]) {
            const showCur = normalizeSimplexStatus(showStatusByAddress[addrKey]);
            if (Number(showCur[statusKey]) !== 1) {
              showStatusByAddress[addrKey] = { ...showCur, [statusKey]: 1 };
              changed = true;
            }
          }
        }
      }

      // Helper to reset statusKey to 0 for an excluded address key
      const clearFlagForKey = (addrKey) => {
        if (activeKeys.has(addrKey)) return;

        if (panelLiveByAddress[addrKey]) {
          const cur = normalizeSimplexStatus(panelLiveByAddress[addrKey]);
          if (Number(cur[statusKey]) === 1) {
            panelLiveByAddress[addrKey] = { ...cur, [statusKey]: 0 };
            changed = true;
          }
        }
        if (showStatusByAddress[addrKey]) {
          const cur = normalizeSimplexStatus(showStatusByAddress[addrKey]);
          if (Number(cur[statusKey]) === 1) {
            showStatusByAddress[addrKey] = { ...cur, [statusKey]: 0 };
            changed = true;
          }
        }
        if (byDeviceAddress[addrKey]) {
          const cur = normalizeSimplexStatus(byDeviceAddress[addrKey]);
          if (Number(cur[statusKey]) === 1) {
            byDeviceAddress[addrKey] = { ...cur, [statusKey]: 0 };
            changed = true;
          }
        }
      };

      // 2. Clear statusKey for addresses in previousAddresses that are excluded in activeAddresses
      for (const prevAddress of previousAddresses) {
        for (const addrKey of collectDeviceAddressKeys(prevAddress)) {
          clearFlagForKey(addrKey);
        }
      }

      // 3. Clear statusKey for any address in store that is not active
      for (const addrKey of Object.keys(panelLiveByAddress)) {
        clearFlagForKey(addrKey);
      }
      for (const addrKey of Object.keys(byDeviceAddress)) {
        clearFlagForKey(addrKey);
      }

      if (!changed) return state;
      return {
        byDeviceAddress,
        byAssetId,
        panelLiveByAddress,
        showStatusByAddress,
        lastSync: Date.now(),
      };
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
      const showStatusByAddress = { ...state.showStatusByAddress };
      indexStatusByAddressKeys(byDeviceAddress, deviceAddress, normalized);
      indexStatusByAssetIdKeys(byAssetId, assetId, normalized);
      for (const addrKey of collectDeviceAddressKeys(deviceAddress)) {
        panelLiveByAddress[addrKey] = { ...normalized };
        showStatusByAddress[addrKey] = { ...normalized };
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
      const showStatusByAddress = { ...state.showStatusByAddress };
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
          showStatusByAddress[addrKey] = { ...normalized };
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
        showStatusByAddress,
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
      if (fb >= FIRE_ACTIVE_SUPERVISORY) return FIRE_ACTIVE_SUPERVISORY;
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
      if (fb >= FIRE_ACTIVE_SUPERVISORY) return FIRE_ACTIVE_SUPERVISORY;
      return FIRE_ACTIVE_NORMAL;
    }
    void s.lastSync;
    return resolveMarkerActiveFromMapping(mapping, deviceAddress, fallback, s);
  });
}

/**
 * Live F/T/S + visual style for a floor-map marker.
 * F=1 → red + ripple; F=0 T=1 → yellow; F=0 T=0 S=1 → purple; F=0 T=0 S=0 → green.
 */
export function useAssetMarkerVisualFromMapping(
  mapping,
  deviceAddress,
  fallback = 0,
  enabled = true,
) {
  // Subscribe to F:T:S so we do not return a new object every render unless status changes.
  const ftsKey = useAssetFireStatusStore((s) => {
    void s.lastSync;
    if (!enabled) {
      const fb = Number(fallback ?? FIRE_ACTIVE_NORMAL);
      if (fb >= FIRE_ACTIVE_ALARM) return "1:0:0";
      if (fb >= FIRE_ACTIVE_TROUBLE) return "0:1:0";
      if (fb >= FIRE_ACTIVE_SUPERVISORY) return "0:0:1";
      return "0:0:0";
    }
    const status = resolveMarkerStatusFromMapping(
      mapping,
      deviceAddress,
      fallback,
      s,
    );
    return `${status.F}:${status.T}:${status.S}`;
  });

  const [fPart, tPart, sPart] = String(ftsKey || "0:0:0").split(":");
  return markerVisualFromFTS(Number(fPart), Number(tPart), Number(sPart));
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
