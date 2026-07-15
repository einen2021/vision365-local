import { create } from "zustand";
import { stripPanelAddressPrefix } from "@/lib/simplexDeviceAddress";

/** Normalize panel addresses so `2:M1-2-0` and `M1-2-0` share one key. */
export function normalizeDeviceAddressKey(address) {
  return stripPanelAddressPrefix(address).toUpperCase();
}

export const useDeviceEnabledStore = create((set, get) => ({
  byAddress: {},

  setEnabled: (address, enabled) => {
    const key = normalizeDeviceAddressKey(address);
    if (!key) return;
    set((state) => ({
      byAddress: { ...state.byAddress, [key]: Boolean(enabled) },
    }));
  },

  isEnabled: (address, fallback = true) => {
    const key = normalizeDeviceAddressKey(address);
    if (!key) return fallback;
    const stored = get().byAddress[key];
    return stored === undefined ? fallback : stored;
  },
}));

export function useIsDeviceEnabled(deviceAddress, fallbackEnabled = true) {
  const key = normalizeDeviceAddressKey(deviceAddress);
  return useDeviceEnabledStore((state) => {
    if (!key) return fallbackEnabled;
    if (key in state.byAddress) return state.byAddress[key];
    return fallbackEnabled;
  });
}
