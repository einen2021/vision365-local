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

  let fromList = null;

  const addressKeys = collectDeviceAddressKeys(deviceAddress);
  for (const addr of addressKeys) {
    if (cache.byDeviceAddress[addr] !== undefined) {
      fromList = normalizeSimplexStatus(cache.byDeviceAddress[addr]);
      break;
    }
  }

  if (!fromList) {
    const idKeys = collectAssetIdKeys(assetId);
    for (const id of idKeys) {
      if (cache.byAssetId[id] !== undefined) {
        fromList = normalizeSimplexStatus(cache.byAssetId[id]);
        break;
      }
    }
  }

  // Panel-list F/T/S from monitoring — preferred over AssetsList so a stale
  // or show-command AssetsList row cannot flip marker colors.
  let fromPanel = null;
  if (cache.panelLiveByAddress) {
    for (const addr of addressKeys) {
      if (cache.panelLiveByAddress[addr] !== undefined) {
        fromPanel = normalizeSimplexStatus(cache.panelLiveByAddress[addr]);
        break;
      }
    }
  }

  if (fromPanel) return fromPanel;
  return fromList;
}

/**
 * Resolve status using every id/address we might have on a floor-map marker.
 * Placement doc ids often differ from AssetsList ids, so try them all.
 * Panel-live F/T from monitoring is preferred over AssetsList.
 * `show` PRIMARY STATUS must not drive marker colors.
 */
export function resolveStatusFromCacheForMapping(
  cache,
  mapping = {},
  deviceAddress = "",
) {
  if (!cache) return null;

  const addresses = [
    deviceAddress,
    mapping.deviceAddress,
    mapping.details?.deviceAddress,
    mapping.partNumber,
    mapping.details?.partNumber,
    resolveAssetDeviceAddress(mapping),
    resolveAssetDeviceAddress(mapping.details || {}),
  ];

  let fromList = null;
  for (const address of addresses) {
    const addressKeys = collectDeviceAddressKeys(address);
    for (const addr of addressKeys) {
      if (cache.byDeviceAddress?.[addr] !== undefined) {
        fromList = normalizeSimplexStatus(cache.byDeviceAddress[addr]);
        break;
      }
    }
    if (fromList) break;
  }

  if (!fromList) {
    const ids = [
      mapping.assetsListId,
      mapping.details?.assetsListId,
      mapping.details?.id,
      mapping.buildingAssetId,
      mapping.id,
      mapping.sanitizedId,
      mapping.assetId,
    ];
    for (const id of ids) {
      const idKeys = collectAssetIdKeys(id);
      for (const key of idKeys) {
        if (cache.byAssetId?.[key] !== undefined) {
          fromList = normalizeSimplexStatus(cache.byAssetId[key]);
          break;
        }
      }
      if (fromList) break;
    }
  }

  // AssetsList meta may expose the panel address when the mapping omitted it.
  const metaAddresses = [];
  if (cache.metaByAssetId) {
    const ids = [
      mapping?.assetsListId,
      mapping?.details?.assetsListId,
      mapping?.buildingAssetId,
      mapping?.id,
      mapping?.assetId,
    ];
    for (const id of ids) {
      const key = String(id || "").trim();
      if (!key) continue;
      const meta =
        cache.metaByAssetId[key] || cache.metaByAssetId[key.toLowerCase()];
      if (meta?.deviceAddress) metaAddresses.push(meta.deviceAddress);
    }
  }

  let fromPanel = null;
  for (const address of [...addresses, ...metaAddresses]) {
    for (const addr of collectDeviceAddressKeys(address)) {
      if (cache.panelLiveByAddress?.[addr] !== undefined) {
        fromPanel = orSimplexStatus(
          fromPanel,
          cache.panelLiveByAddress[addr],
        );
      }
    }
  }

  // Monitoring list wins — do not OR with AssetsList (can still hold old show data).
  if (fromPanel) return fromPanel;
  return fromList;
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

/** Prefer cached panel F/T status (by deviceAddress / id), else fall back to building active */
export function resolveMarkerActive(assetId, deviceAddress, fallbackActive, cache) {
  const { F, T } = resolveMarkerStatus(assetId, deviceAddress, fallbackActive, cache);
  return simplexStatusToActive(F, T);
}

/** Prefer full mapping identity (ids + address) when resolving live status. */
export function resolveMarkerActiveFromMapping(
  mapping,
  deviceAddress,
  fallbackActive,
  cache,
) {
  const { F, T } = resolveMarkerStatusFromMapping(
    mapping,
    deviceAddress,
    fallbackActive,
    cache,
  );
  return simplexStatusToActive(F, T);
}

/** Resolve raw F/T for a floor-map mapping (with AssetsList meta fallback). */
export function resolveMarkerStatusFromMapping(
  mapping,
  deviceAddress,
  fallbackActive,
  cache,
) {
  const cached = resolveStatusFromCacheForMapping(cache, mapping, deviceAddress);
  if (cached) {
    return {
      F: Number(cached.F) === 1 ? 1 : 0,
      T: Number(cached.T) === 1 ? 1 : 0,
      S: Number(cached.S) === 1 ? 1 : 0,
    };
  }

  // AssetsList meta may have the address even when the floor mapping omitted it.
  const ids = [
    mapping?.assetsListId,
    mapping?.details?.assetsListId,
    mapping?.buildingAssetId,
    mapping?.id,
    mapping?.assetId,
  ];
  for (const id of ids) {
    const key = String(id || "").trim();
    if (!key || !cache?.metaByAssetId) continue;
    const meta =
      cache.metaByAssetId[key] || cache.metaByAssetId[key.toLowerCase()];
    if (!meta?.deviceAddress) continue;
    const fromMeta = resolveStatusFromCache(cache, meta.deviceAddress, key);
    if (fromMeta) {
      return {
        F: Number(fromMeta.F) === 1 ? 1 : 0,
        T: Number(fromMeta.T) === 1 ? 1 : 0,
        S: Number(fromMeta.S) === 1 ? 1 : 0,
      };
    }
  }

  const fallback = Number(fallbackActive ?? FIRE_ACTIVE_NORMAL);
  if (fallback >= FIRE_ACTIVE_ALARM) return { F: 1, T: 0, S: 0 };
  if (fallback >= FIRE_ACTIVE_TROUBLE) return { F: 0, T: 1, S: 0 };
  return { F: 0, T: 0, S: 0 };
}

/**
 * Floor-map colors + ripple from F/T:
 * - F=1 (T=0 or T=1) → red + ripple
 * - F=0, T=1 → yellow, no ripple
 * - F=0, T=0 → green, no ripple
 */
export function markerVisualFromFT(f, t) {
  const F = Number(f) === 1 ? 1 : 0;
  const T = Number(t) === 1 ? 1 : 0;

  if (F === 1) {
    return {
      F,
      T,
      active: FIRE_ACTIVE_ALARM,
      borderColor: "rgb(239, 68, 68)",
      dimColor: "rgba(239, 68, 68, 0.22)",
      radarColor: "rgba(239, 68, 68, 0.6)",
      ripple: true,
    };
  }

  if (T === 1) {
    return {
      F,
      T,
      active: FIRE_ACTIVE_TROUBLE,
      borderColor: "rgb(234, 179, 8)",
      dimColor: "rgba(234, 179, 8, 0.22)",
      radarColor: "rgba(234, 179, 8, 0.6)",
      ripple: false,
    };
  }

  return {
    F,
    T,
    active: FIRE_ACTIVE_NORMAL,
    borderColor: "rgb(34, 197, 94)",
    dimColor: "rgba(34, 197, 94, 0.22)",
    radarColor: "rgba(34, 197, 94, 0.6)",
    ripple: false,
  };
}

/** Pulse animation only when fire alarm (F=1) */
export function shouldFireRipple(activeValue) {
  return isFireAlarmActive(activeValue);
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

/** OR two simplex status objects (any flag already 1 stays 1). */
export function orSimplexStatus(a, b) {
  const left = normalizeSimplexStatus(a);
  const right = normalizeSimplexStatus(b);
  return {
    F: left.F === 1 || right.F === 1 ? 1 : 0,
    T: left.T === 1 || right.T === 1 ? 1 : 0,
    S: left.S === 1 || right.S === 1 ? 1 : 0,
  };
}

/**
 * Keep panel-list F/T/S alive on top of AssetsList rows.
 * The 1s AssetsList poll often still has F=0 before DB writes finish (or when
 * the address is not in AssetsList) — without this merge, markers snap back to green.
 */
export function mergePanelLiveIntoAddressMap(byDeviceAddress = {}, panelLiveByAddress = {}) {
  const merged = { ...byDeviceAddress };
  for (const [key, panelStatus] of Object.entries(panelLiveByAddress || {})) {
    if (!key) continue;
    merged[key] = orSimplexStatus(merged[key], panelStatus);
  }
  return merged;
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
  const merged = { ...marker, ...meta };
  const address = String(resolveAssetDeviceAddress(merged) || "").trim();
  const location = String(merged.deviceLocation || "").trim();

  const lines = [];
  if (address) lines.push(`Address: ${address}`);
  if (location) lines.push(`Location: ${location}`);
  if (lines.length > 0) return lines.join("\n");

  return merged?.assetName || merged?.itemType || id || "Asset";
}
