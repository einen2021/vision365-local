import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  cacheChanged,
  normalizeDeviceAddress,
  resolveMarkerActive,
} from "@/lib/assetFireStatus";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

export const FIRE_STATUS_POLL_MS = 1000;

let pollTimer = null;

export const useAssetFireStatusStore = create((set, get) => ({
  byDeviceAddress: {},
  byAssetId: {},
  metaByAssetId: {},
  lastSync: null,
  isPolling: false,

  syncFromAssetsList: async () => {
    try {
      const snapshot = await getDocs(collection(db, "AssetsList"));
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
        };
        const addr = resolveAssetDeviceAddress(data);

        if (addr) byDeviceAddress[addr] = status;
        byAssetId[docSnap.id] = status;
        storeMeta(docSnap.id, data);

        if (data.assetId) {
          byAssetId[String(data.assetId)] = status;
          storeMeta(String(data.assetId), data);
        }
        if (data.buildingAssetId) {
          byAssetId[String(data.buildingAssetId)] = status;
          storeMeta(String(data.buildingAssetId), data);
        }
      });

      const prev = get();
      const nextCache = { byDeviceAddress, byAssetId, metaByAssetId };
      if (!cacheChanged(prev, nextCache)) return;

      set({
        byDeviceAddress,
        byAssetId,
        metaByAssetId,
        lastSync: Date.now(),
      });
    } catch (error) {
      console.warn("[assetFireStatus] sync failed:", error);
    }
  },

  startPolling: () => {
    if (pollTimer) return;
    set({ isPolling: true });
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

  /** Instant UI update after manual F/T reset (before next DB poll). */
  patchSimplexStatus: (assetId, deviceAddress, status) => {
    const addr = normalizeDeviceAddress(deviceAddress);
    const normalized = {
      F: Number(status?.F ?? 0),
      T: Number(status?.T ?? 0),
    };
    set((state) => {
      const byDeviceAddress = { ...state.byDeviceAddress };
      const byAssetId = { ...state.byAssetId };
      if (addr) byDeviceAddress[addr] = normalized;
      if (assetId) byAssetId[String(assetId)] = normalized;
      return { byDeviceAddress, byAssetId, lastSync: Date.now() };
    });
  },
}));

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
