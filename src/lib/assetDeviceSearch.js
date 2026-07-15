import { collectDeviceAddressKeys } from "@/lib/assetFireStatus";
import {
  formatNestedPlacementLabel,
  isAssetPlacedInBuilding,
} from "@/lib/floorMapAssets";
import {
  buildFloorPlanViewUrl,
  getFireDeviceNavigationTarget,
} from "@/lib/fireAlertFloorNavigation";
import { buildGraphicsViewUrl } from "@/lib/graphicsViewSelection";
import { normalizeBuildingName } from "@/lib/buildingNames";
import {
  resolveAssetDeviceAddress,
  stripPanelAddressPrefix,
} from "@/lib/simplexDeviceAddress";

/** Normalize a device-address search query for matching. */
export function normalizeDeviceSearchQuery(query) {
  return String(query || "").trim().toUpperCase();
}

function collectSearchableAddressKeys(asset = {}) {
  const keys = new Set();
  const resolved = resolveAssetDeviceAddress(asset);

  if (resolved) {
    keys.add(resolved.toUpperCase());
    for (const key of collectDeviceAddressKeys(resolved)) {
      keys.add(String(key).toUpperCase());
    }
  }

  for (const raw of [asset.deviceAddress, asset.partNumber, asset.id]) {
    const value = String(raw || "").trim().toUpperCase();
    if (!value) continue;
    keys.add(value);
    for (const key of collectDeviceAddressKeys(value)) {
      keys.add(String(key).toUpperCase());
    }
  }

  return keys;
}

/** True when an AssetsList row matches a partial device-address query. */
export function assetMatchesDeviceQuery(asset = {}, query = "") {
  const normalizedQuery = normalizeDeviceSearchQuery(query);
  if (normalizedQuery.length < 2) return false;

  const strippedQuery = stripPanelAddressPrefix(normalizedQuery).toUpperCase();
  const keys = collectSearchableAddressKeys(asset);

  for (const key of keys) {
    if (key.includes(normalizedQuery) || normalizedQuery.includes(key)) {
      return true;
    }

    const strippedKey = stripPanelAddressPrefix(key).toUpperCase();
    if (!strippedKey || !strippedQuery) continue;
    if (
      strippedKey.includes(strippedQuery) ||
      strippedQuery.includes(strippedKey)
    ) {
      return true;
    }
  }

  return false;
}

/** Human-readable building → floor → section → subsection summary. */
export function buildAssetLocationSummary(asset = {}) {
  const building = normalizeBuildingName(asset.buildingName || asset.building || "");
  const parts = [];

  if (building) parts.push(`Building: ${building}`);
  if (asset.floorName) parts.push(`Floor: ${asset.floorName}`);
  if (asset.sectionName) parts.push(`Section: ${asset.sectionName}`);
  if (asset.subsectionName) parts.push(`Subsection: ${asset.subsectionName}`);
  if (asset.deviceLocation) parts.push(`Location: ${asset.deviceLocation}`);

  if (parts.length > 0) return parts.join(" · ");
  if (isAssetPlacedInBuilding(asset)) return formatNestedPlacementLabel(asset);
  return "Not placed on a floor plan";
}

/** Build a search result row with navigation target for Graphics View. */
export function buildAssetSearchResult(asset = {}, docId = "") {
  const data = { ...asset, id: docId || asset.id || "" };
  const deviceAddress = resolveAssetDeviceAddress(data);
  const building = normalizeBuildingName(data.buildingName || data.building || "");
  const navTarget = getFireDeviceNavigationTarget({
    ...data,
    buildingName: building,
    building,
  });

  let navigationUrl = clientMainRouteFallback();
  if (navTarget?.building && navTarget?.floorId && navTarget?.sectionId) {
    navigationUrl = buildFloorPlanViewUrl(navTarget);
  } else if (building) {
    navigationUrl = buildGraphicsViewUrl({ building });
  }

  return {
    id: data.id,
    deviceAddress,
    name:
      data.description ||
      data.name ||
      data.deviceLocation ||
      deviceAddress ||
      "Unnamed asset",
    locationSummary: buildAssetLocationSummary(data),
    navigationUrl,
    placed: isAssetPlacedInBuilding(data),
    raw: data,
  };
}

function clientMainRouteFallback() {
  return "/dashboard/floor_configuration/view";
}

/** Filter and rank AssetsList rows for a device-address query. */
export function searchAssetsByDeviceAddress(rows = [], query = "", limit = 12) {
  const normalizedQuery = normalizeDeviceSearchQuery(query);
  if (normalizedQuery.length < 2) return [];

  const matches = [];

  for (const row of rows) {
    if (!assetMatchesDeviceQuery(row.data, normalizedQuery)) continue;
    matches.push(buildAssetSearchResult(row.data, row.id));
  }

  matches.sort((a, b) => {
    const aExact = String(a.deviceAddress || "").toUpperCase() === normalizedQuery;
    const bExact = String(b.deviceAddress || "").toUpperCase() === normalizedQuery;
    if (aExact !== bExact) return aExact ? -1 : 1;
    if (a.placed !== b.placed) return a.placed ? -1 : 1;
    return String(a.deviceAddress || "").localeCompare(String(b.deviceAddress || ""));
  });

  return matches.slice(0, limit);
}
