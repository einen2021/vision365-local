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
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";
import { resolveFloorDetailsFromCache } from "@/lib/assetAddressFloorIndex";

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

/** Split "2:M1-2-1" into { panel: "2", rest: "M1-2-1" } (panel null when absent). */
function splitPanelPrefix(value = "") {
  const match = String(value || "").match(/^(\d+):(.*)$/);
  return match ? { panel: match[1], rest: match[2] } : { panel: null, rest: value };
}

/**
 * True when an AssetsList row matches a partial device-address query.
 * A panel prefix in the query ("2:") is binding — "2:M2-4-0" never matches
 * "3:M2-4-0", since the same M-address on another panel is a different device.
 */
export function assetMatchesDeviceQuery(asset = {}, query = "") {
  const normalizedQuery = normalizeDeviceSearchQuery(query);
  if (normalizedQuery.length < 2) return false;

  const { panel: queryPanel, rest: queryRest } = splitPanelPrefix(normalizedQuery);
  const keys = collectSearchableAddressKeys(asset);

  for (const key of keys) {
    if (key === normalizedQuery) return true;

    const { panel: keyPanel, rest: keyRest } = splitPanelPrefix(key);

    if (queryPanel) {
      // Different panel → different physical device.
      if (keyPanel && keyPanel !== queryPanel) continue;
      // Same panel: user may still be typing the rest of the address.
      if (keyPanel && key.startsWith(normalizedQuery)) return true;
      // Asset stored without a panel prefix: compare the M-address part.
      if (!keyPanel && queryRest && keyRest.startsWith(queryRest)) return true;
      continue;
    }

    // No panel typed: match the address part on any panel (or raw ids).
    if (keyRest.includes(normalizedQuery) || key.includes(normalizedQuery)) {
      return true;
    }
  }

  return false;
}

/** Lower is better: exact address, then same-panel, then everything else. */
function rankSearchResult(result, normalizedQuery) {
  const address = String(result.deviceAddress || "").toUpperCase();
  if (!address) return 3;
  if (address === normalizedQuery) return 0;
  if (collectDeviceAddressKeys(address).has(normalizedQuery)) return 0;
  const { panel: queryPanel } = splitPanelPrefix(normalizedQuery);
  const { panel: addressPanel } = splitPanelPrefix(address);
  if (queryPanel && addressPanel === queryPanel) return 1;
  return 2;
}

/** Merge cached floor details onto an AssetsList row for labels + navigation. */
function mergeAssetWithFloorDetails(asset = {}, docId = "", floorDetails = null) {
  if (!floorDetails) return { ...asset, id: docId || asset.id || "" };

  return {
    ...asset,
    id: docId || asset.id || floorDetails.assetId || "",
    buildingName: floorDetails.building || asset.buildingName || asset.building || "",
    building: floorDetails.building || asset.building || asset.buildingName || "",
    floorId: floorDetails.floorId || asset.floorId || "",
    sectionId: floorDetails.sectionId || asset.sectionId || "",
    subsectionId: floorDetails.subsectionId || asset.subsectionId || "",
    floorName: floorDetails.floorName || asset.floorName || "",
    sectionName: floorDetails.sectionName || asset.sectionName || "",
    subsectionName: floorDetails.subsectionName || asset.subsectionName || "",
    nestedPath: floorDetails.nestedPath || asset.nestedPath || "",
  };
}

/** Human-readable building → floor → section → subsection summary. */
export function buildAssetLocationSummary(asset = {}) {
  const building = normalizeBuildingName(asset.buildingName || asset.building || "");
  const parts = [];

  // Prefer nested floor-plan hierarchy over the raw Simplex deviceLocation string.
  if (building) parts.push(`Building: ${building}`);
  if (asset.floorName) parts.push(`Floor: ${asset.floorName}`);
  if (asset.sectionName) parts.push(`Section: ${asset.sectionName}`);
  if (asset.subsectionName) parts.push(`Subsection: ${asset.subsectionName}`);

  const hasHierarchy = parts.length > 0;

  // nestedPath is written on place (e.g. "WeDo > SB > Plan 1") when names are present.
  if (!hasHierarchy && asset.nestedPath) {
    const fromPath = formatNestedPlacementLabel(asset);
    if (fromPath && fromPath !== "Unknown location") {
      return asset.deviceLocation
        ? `${fromPath} · Location: ${asset.deviceLocation}`
        : fromPath;
    }
  }

  if (asset.deviceLocation) parts.push(`Location: ${asset.deviceLocation}`);

  if (parts.length > 0) {
    // Only Location (no Building/Floor/Section) — still try placement fields if present.
    if (!hasHierarchy && isAssetPlacedInBuilding(asset)) {
      const placement = formatNestedPlacementLabel(asset);
      if (placement && placement !== "Unknown location") {
        return asset.deviceLocation
          ? `${placement} · Location: ${asset.deviceLocation}`
          : placement;
      }
    }
    return parts.join(" · ");
  }

  if (isAssetPlacedInBuilding(asset)) return formatNestedPlacementLabel(asset);
  return "Not placed on a floor plan";
}

/**
 * Build a search result row with navigation target for Graphics View.
 * Pass `floorIndex` (address → floor details Map) for instant placement labels.
 */
export function buildAssetSearchResult(asset = {}, docId = "", options = {}) {
  const { floorIndex = null, buildingHint = "" } = options;
  const floorDetails = resolveFloorDetailsFromCache(
    floorIndex,
    asset,
    docId,
    buildingHint,
  );
  const data = mergeAssetWithFloorDetails(asset, docId, floorDetails);
  const deviceAddress = resolveAssetDeviceAddress(data);
  const building = normalizeBuildingName(data.buildingName || data.building || "");
  const navTarget = getFireDeviceNavigationTarget({
    ...data,
    buildingName: building,
    building,
  });

  let navigationUrl = clientMainRouteFallback();
  if (navTarget?.building && navTarget?.floorId && navTarget?.sectionId) {
    navigationUrl = buildFloorPlanViewUrl({
      ...navTarget,
      floorName: data.floorName,
      sectionName: data.sectionName,
      subsectionName: data.subsectionName,
    });
  } else if (building) {
    navigationUrl = buildGraphicsViewUrl({ building });
  }

  let locationSummary = buildAssetLocationSummary(data);
  // If hierarchy is present, keep Simplex location as a secondary hint.
  if (
    floorDetails?.deviceLocation &&
    locationSummary.includes("Building:") &&
    !locationSummary.includes(floorDetails.deviceLocation)
  ) {
    locationSummary = `${locationSummary} · Location: ${floorDetails.deviceLocation}`;
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
    locationSummary,
    navigationUrl,
    placed: Boolean(floorDetails) || isAssetPlacedInBuilding(data),
    floorDetails: floorDetails || null,
    raw: data,
  };
}

function clientMainRouteFallback() {
  return "/dashboard/floor_configuration/view";
}

/**
 * Filter and rank AssetsList rows for a device-address query.
 * Pass the warmed `floorIndex` so Building/Floor/Section come from memory.
 */
export function searchAssetsByDeviceAddress(
  rows = [],
  query = "",
  limitOrOptions = 12,
) {
  const options =
    typeof limitOrOptions === "number"
      ? { limit: limitOrOptions }
      : limitOrOptions || {};
  const limit = options.limit ?? 12;
  const floorIndex = options.floorIndex || null;
  const buildingHint = options.buildingHint || "";

  const normalizedQuery = normalizeDeviceSearchQuery(query);
  if (normalizedQuery.length < 2) return [];

  const matches = [];

  for (const row of rows) {
    if (!assetMatchesDeviceQuery(row.data, normalizedQuery)) continue;
    matches.push(
      buildAssetSearchResult(row.data, row.id, { floorIndex, buildingHint }),
    );
  }

  matches.sort((a, b) => {
    const aRank = rankSearchResult(a, normalizedQuery);
    const bRank = rankSearchResult(b, normalizedQuery);
    if (aRank !== bRank) return aRank - bRank;
    if (a.placed !== b.placed) return a.placed ? -1 : 1;
    return String(a.deviceAddress || "").localeCompare(String(b.deviceAddress || ""));
  });

  return matches.slice(0, limit);
}
