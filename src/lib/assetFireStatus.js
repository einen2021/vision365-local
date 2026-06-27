/** Active scale for floor maps / 3D markers — derived from simplexStatus F and T */
export const FIRE_ACTIVE_NORMAL = 0;
export const FIRE_ACTIVE_TROUBLE = 5;
export const FIRE_ACTIVE_ALARM = 9;

import { stripPanelAddressPrefix, resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

export function normalizeDeviceAddress(value) {
  return stripPanelAddressPrefix(value).toUpperCase();
}

/** Normalize cache entry (legacy number = F only) to { F, T } */
export function normalizeSimplexStatus(entry) {
  if (entry == null) return { F: 0, T: 0 };
  if (typeof entry === "number") return { F: Number(entry), T: 0 };
  return {
    F: Number(entry.F ?? entry.f ?? 0),
    T: Number(entry.T ?? entry.t ?? 0),
    S: Number(entry.S ?? entry.s ?? 0),
  };
}

/** Map panel simplexStatus F/T to marker active scale */
export function simplexStatusToActive(f, t) {
  if (Number(f) === 1) return FIRE_ACTIVE_ALARM;
  if (Number(t) === 1) return FIRE_ACTIVE_TROUBLE;
  return FIRE_ACTIVE_NORMAL;
}

/** @deprecated Use simplexStatusToActive(F, T) */
export function fireValueToActive(f) {
  return simplexStatusToActive(f, 0);
}

export function isFireAlarmActive(activeValue) {
  return Number(activeValue) >= FIRE_ACTIVE_ALARM;
}

export function isFireTroubleActive(activeValue) {
  const v = Number(activeValue);
  return v >= FIRE_ACTIVE_TROUBLE && v < FIRE_ACTIVE_ALARM;
}

function resolveStatusFromCache(cache, deviceAddress, assetId) {
  if (!cache) return null;

  const addressKeys = collectDeviceAddressKeys(deviceAddress);
  for (const addr of addressKeys) {
    if (cache.byDeviceAddress[addr] !== undefined) {
      return normalizeSimplexStatus(cache.byDeviceAddress[addr]);
    }
  }

  const idKeys = collectAssetIdKeys(assetId);
  for (const id of idKeys) {
    if (cache.byAssetId[id] !== undefined) {
      return normalizeSimplexStatus(cache.byAssetId[id]);
    }
  }

  return null;
}

/** All cache keys to try for a panel / Simplex device address. */
export function collectDeviceAddressKeys(deviceAddress) {
  const keys = new Set();
  const raw = String(deviceAddress || "").trim();
  if (!raw) return keys;

  keys.add(raw.toUpperCase());
  keys.add(normalizeDeviceAddress(raw));

  const resolved = resolveAssetDeviceAddress({ deviceAddress: raw });
  if (resolved) {
    keys.add(resolved.toUpperCase());
    keys.add(normalizeDeviceAddress(resolved));
  }

  return keys;
}

/** All cache keys to try for a floor-map / AssetsList asset id. */
export function collectAssetIdKeys(assetId) {
  const keys = new Set();
  const raw = String(assetId || "").trim();
  if (!raw) return keys;
  keys.add(raw);
  keys.add(raw.toLowerCase());
  return keys;
}

export function indexStatusByAddressKeys(byDeviceAddress, deviceAddress, status) {
  for (const key of collectDeviceAddressKeys(deviceAddress)) {
    byDeviceAddress[key] = status;
  }
}

export function indexStatusByAssetIdKeys(byAssetId, assetId, status) {
  for (const key of collectAssetIdKeys(assetId)) {
    byAssetId[key] = status;
  }
}

/** Resolve { F, T } from cache or fallback active value */
export function resolveMarkerStatus(assetId, deviceAddress, fallbackActive, cache) {
  const cached = resolveStatusFromCache(cache, deviceAddress, assetId);
  if (cached) return cached;

  const fallback = Number(fallbackActive ?? FIRE_ACTIVE_NORMAL);
  if (fallback >= FIRE_ACTIVE_ALARM) return { F: 1, T: 0 };
  if (fallback >= FIRE_ACTIVE_TROUBLE) return { F: 0, T: 1 };
  return { F: 0, T: 0 };
}

/** Prefer cached panel F/T status (by deviceAddress), else fall back to building active */
export function resolveMarkerActive(assetId, deviceAddress, fallbackActive, cache) {
  const { F, T } = resolveMarkerStatus(assetId, deviceAddress, fallbackActive, cache);
  return simplexStatusToActive(F, T);
}

/** 2D floor map — green normal, yellow trouble, red fire alarm */
export function getFireRadarColor(activeValue) {
  if (isFireAlarmActive(activeValue)) return "rgba(239, 68, 68, 0.6)";
  if (isFireTroubleActive(activeValue)) return "rgba(234, 179, 8, 0.6)";
  return "rgba(34, 197, 94, 0.6)";
}

export function getFireDimColor(activeValue) {
  if (isFireAlarmActive(activeValue)) return "rgba(239, 68, 68, 0.22)";
  if (isFireTroubleActive(activeValue)) return "rgba(234, 179, 8, 0.22)";
  return "rgba(34, 197, 94, 0.22)";
}

export function getFireBorderColor(activeValue) {
  if (isFireAlarmActive(activeValue)) return "rgb(239, 68, 68)";
  if (isFireTroubleActive(activeValue)) return "rgb(234, 179, 8)";
  return "rgb(34, 197, 94)";
}

/** 3D wireframe markers */
export function getFireMarkerHexColor(activeValue) {
  if (isFireAlarmActive(activeValue)) return "#ef4444";
  if (isFireTroubleActive(activeValue)) return "#eab308";
  return "#16a34a";
}

/** Pulse animation only when fire alarm (F=1) */
export function shouldFireRipple(activeValue) {
  return isFireAlarmActive(activeValue);
}

/** Human-readable status label + color for UI lists (F/T derived active value) */
export function getFireStatusDisplay(activeValue) {
  if (isFireAlarmActive(activeValue)) {
    return { label: "Fire", color: "rgb(239, 68, 68)" };
  }
  if (isFireTroubleActive(activeValue)) {
    return { label: "Trouble", color: "rgb(234, 179, 8)" };
  }
  return { label: "Normal", color: "rgb(34, 197, 94)" };
}

function mapsEqual(a, b) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const left = normalizeSimplexStatus(a[key]);
    const right = normalizeSimplexStatus(b[key]);
    if (left.F !== right.F || left.T !== right.T || left.S !== right.S) return false;
  }
  return true;
}

export function mergeFireIntoActiveStatuses(activeStatuses, assets, cache) {
  if (!cache || !Array.isArray(assets)) return activeStatuses || {};

  const merged = { ...(activeStatuses || {}) };

  for (const asset of assets) {
    const id = asset.id || asset.buildingAssetId;
    if (!id) continue;

    const resolvedAddress = resolveAssetDeviceAddress(asset);
    const fallback = merged[id]?.active ?? asset.active ?? FIRE_ACTIVE_NORMAL;
    const status = resolveMarkerStatus(id, resolvedAddress, fallback, cache);
    const active = simplexStatusToActive(status.F, status.T);

    merged[id] = {
      ...(merged[id] || {}),
      active,
      fireStatus: status,
    };
  }

  return merged;
}

export function cacheChanged(prev, next) {
  if (!prev || !next) return true;
  return (
    !mapsEqual(prev.byDeviceAddress, next.byDeviceAddress) ||
    !mapsEqual(prev.byAssetId, next.byAssetId) ||
    !metaMapsEqual(prev.metaByAssetId, next.metaByAssetId)
  );
}

function metaMapsEqual(a, b) {
  const keysA = Object.keys(a || {});
  const keysB = Object.keys(b || {});
  if (keysA.length !== keysB.length) return false;
  for (const key of keysA) {
    const left = a[key] || {};
    const right = b[key] || {};
    if (
      String(left.deviceLocation || "") !== String(right.deviceLocation || "") ||
      String(left.deviceAddress || "") !== String(right.deviceAddress || "")
    ) {
      return false;
    }
  }
  return true;
}

/** Tooltip for floor-map asset markers */
export function getAssetMarkerTooltip(marker, metaByAssetId = {}) {
  const id = marker?.id || marker?.assetId || marker?.buildingAssetId || "";
  const meta = (id && metaByAssetId[id]) || {};
  const address = String(resolveAssetDeviceAddress({ ...marker, ...meta }) || "").trim();
  if (address) return address;
  return marker?.assetName || marker?.itemType || id || "Asset";
}
