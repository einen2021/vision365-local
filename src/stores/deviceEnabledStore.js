import { create } from "zustand";

/**
 * Normalize a panel address into a store key. Keeps the panel prefix intact —
 * "2:M1-2-0", "3:M1-2-0", and unprefixed "M1-2-0" are different physical
 * devices and must never share an enabled/disabled key.
 */
export function normalizeDeviceAddressKey(address) {
  return String(address || "").trim().toUpperCase();
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
