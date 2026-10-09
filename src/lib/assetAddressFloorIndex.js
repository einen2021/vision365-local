import { db } from "@/config/firebase";
import { normalizeBuildingName } from "@/lib/buildingNames";
import {
  collectAssetAddressMatchKeys,
  expandPanelAddressMatchKeys,
} from "@/lib/assetsListSimplexStatus";
import {
  getAssetsListIdFromMapping,
  getAssetsListSnapshot,
  hasFloorPosition,
  resolveMappingDeviceFields,
} from "@/lib/floorMapAssets";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

/**
 * In-memory cache:
 *   addressKey (uppercase) → floor placement details
 *
 * Sources:
 * 1. AssetsList snapshot (floorId/sectionId on the row)
 * 2. Open Graphics View plan mappings (covers assets placed only in assetMappings)
 */
let floorIndexRef = null;
let floorIndexPromise = null;
/** Live plans currently open in Graphics View — re-applied after AssetsList rebuilds. */
const livePlanEntries = new Map();

function planKey({ building, floorId, sectionId, subsectionId = "" }) {
  return [
    normalizeBuildingName(building),
    String(floorId || ""),
    String(sectionId || ""),
    String(subsectionId || ""),
  ].join("::");
}

function ensureIndexShell() {
  if (floorIndexRef?.byAddress) return floorIndexRef;
  floorIndexRef = {
    snapshot: null,
    byAddress: new Map(),
    byAssetId: new Map(),
    rows: [],
  };
  return floorIndexRef;
}

/** Write one plan's markers into the address / assetId maps. */
function applyPlanMappingsToMaps(byAddress, byAssetId, plan) {
  const normalizedBuilding = normalizeBuildingName(plan.building);
  if (!normalizedBuilding || !plan.floorId || !plan.sectionId) return 0;

  const list = Array.isArray(plan.mappings) ? plan.mappings : [];
  let registered = 0;

  for (const mapping of list) {
    const address =
      resolveMappingDeviceFields(mapping).deviceAddress ||
      resolveAssetDeviceAddress(mapping) ||
      "";
    const assetId = String(
      getAssetsListIdFromMapping(mapping) ||
        mapping.assetsListId ||
        mapping.id ||
        "",
    ).trim();

    if (!address && !assetId) continue;

    const details = {
      building: normalizedBuilding,
      floorId: plan.floorId,
      sectionId: plan.sectionId,
      subsectionId: plan.subsectionId || "",
      assetId,
      address,
      floorName: plan.floorName || plan.floorId,
      sectionName: plan.sectionName || plan.sectionId,
      subsectionName: plan.subsectionName || plan.subsectionId || "",
      nestedPath: mapping.nestedPath || "",
      deviceLocation: String(
        mapping.deviceLocation || mapping.details?.deviceLocation || "",
      ).trim(),
      deviceDescription: String(
        mapping.deviceDescription ||
          mapping.description ||
          mapping.details?.deviceDescription ||
          mapping.details?.description ||
          "",
      ).trim(),
      placed: true,
      fromLivePlan: true,
    };

    if (assetId) {
      byAssetId.set(assetId, details);
    }

    const keySource = {
      ...mapping,
      deviceAddress: address,
      id: assetId,
    };
    for (const key of collectAssetAddressMatchKeys(keySource, assetId)) {
      // Live plan markers always win — AssetsList may lack floor/section ids.
      byAddress.set(key, details);
      registered += 1;
    }
  }

  return registered;
}

/** Re-apply every open Graphics View plan onto the Maps. */
function reapplyLivePlans(index = floorIndexRef) {
  if (!index?.byAddress) return;
  for (const plan of livePlanEntries.values()) {
    applyPlanMappingsToMaps(index.byAddress, index.byAssetId, plan);
  }
}

/** Clear the address → floor details map (call when AssetsList cache is invalidated). */
export function clearAddressFloorDetailsIndex() {
  floorIndexRef = null;
  floorIndexPromise = null;
  // Keep livePlanEntries — they will be re-applied after the next rebuild.
}

/**
 * Drop deleted assets from the in-memory address → floor Map (O(keys)).
 * Keeps Location / placement lookups accurate without a full rebuild.
 */
export function removeAssetsFromAddressFloorIndex(assets = []) {
  if (!floorIndexRef?.byAddress && !floorIndexRef?.byAssetId) return;

  for (const asset of assets || []) {
    const docId = String(asset?.id || asset?.assetsListId || "").trim();
    if (docId && floorIndexRef.byAssetId?.has(docId)) {
      floorIndexRef.byAssetId.delete(docId);
    }

    for (const key of collectAssetAddressMatchKeys(asset || {}, docId)) {
      floorIndexRef.byAddress?.delete(key);
    }
  }
}

/**
 * Pull nested floor-plan fields from an AssetsList row.
 * Returns null when the asset is not placed on a floor/section.
 */
export function extractFloorDetailsFromAsset(asset = {}, docId = "") {
  const building = normalizeBuildingName(asset.buildingName || asset.building || "");
  const floorId = asset.floorId || asset.floorDetails?.id || "";
  const sectionId = asset.sectionId || asset.sectionDetails?.id || "";
  const subsectionId = asset.subsectionId || asset.subsectionDetails?.id || "";
  const placementLevel =
    asset.placementLevel || (subsectionId ? "subsection" : "section");

  // Need at least floor + section ids to deep-link into Graphics View.
  if (!floorId || !sectionId) return null;

  // Prefer placed markers (x/y). Still allow rows that only have hierarchy ids.
  const placed = hasFloorPosition(asset) || Boolean(asset.nestedPath);

  const address =
    resolveAssetDeviceAddress(asset) ||
    String(asset.deviceAddress || "").trim() ||
    "";

  return {
    building,
    floorId,
    sectionId,
    subsectionId: placementLevel === "subsection" ? subsectionId || "" : "",
    assetId: String(docId || asset.id || asset.assetsListId || "").trim(),
    address,
    floorName: asset.floorName || asset.floorDetails?.name || floorId || "",
    sectionName: asset.sectionName || asset.sectionDetails?.name || sectionId || "",
    subsectionName:
      asset.subsectionName || asset.subsectionDetails?.name || subsectionId || "",
    nestedPath: asset.nestedPath || "",
    deviceLocation: String(asset.deviceLocation || asset.details?.deviceLocation || "").trim(),
    deviceDescription: String(
      asset.deviceDescription ||
        asset.description ||
        asset.details?.deviceDescription ||
        asset.details?.description ||
        "",
    ).trim(),
    placed,
  };
}

/** Uppercase, whitespace-collapsed comparison key for panel location text. */
function normalizeLocationText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\bCRDR\b/g, "CORRIDOR")
    .replace(/\bCORR\b/g, "CORRIDOR")
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/**
 * Find every AssetsList doc whose deviceLocation / deviceDescription matches a
 * fire-panel-printed location string (e.g. "SUB BS CORRIDOR COS 21 SB/L1/2").
 * More than one match means the location text is ambiguous (shared by
 * multiple devices) — callers that only need the first match should prefer
 * findAssetsListDocByLocationText.
 * Returns [{ id, data }].
 */
export async function findAllAssetsListDocsByLocationText(locationText) {
  const target = normalizeLocationText(locationText);
  if (!target) return [];

  const snapshot = await getAssetsListSnapshot(db);
  const matches = [];
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const candidates = [data.deviceLocation, data.deviceDescription, data.description, data.location];
    const matched = candidates.some(
      (candidate) => candidate && normalizeLocationText(candidate) === target,
    );
    if (matched) matches.push({ id: docSnap.id, data });
  }

  // If no direct exact match, try substring match if target is specific
  if (matches.length === 0 && target.length > 6) {
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const candidates = [data.deviceLocation, data.deviceDescription, data.description, data.location];
      const matched = candidates.some((candidate) => {
        if (!candidate) return false;
        const normCand = normalizeLocationText(candidate);
        return normCand && (normCand.includes(target) || target.includes(normCand));
      });
      if (matched) matches.push({ id: docSnap.id, data });
    }
  }

  return matches;
}

/**
 * Find the AssetsList doc whose deviceLocation / deviceDescription matches a
 * fire-panel-printed location string (e.g. "SUB BS CORRIDOR COS 21 SB/L1/2").
 * Returns { id, data } or null.
 */
export async function findAssetsListDocByLocationText(locationText) {
  const matches = await findAllAssetsListDocsByLocationText(locationText);
  return matches[0] || null;
}

/**
 * Match a fire-panel-printed location string against AssetsList and return the
 * matched asset's device address, or "" when nothing matches.
 */
export async function findDeviceAddressByLocationText(locationText) {
  const match = await findAssetsListDocByLocationText(locationText);
  if (!match) return "";
  return resolveAssetDeviceAddress(match.data) || match.data.deviceAddress || match.id || "";
}

/**
 * Match a fire-panel-printed location string against AssetsList and return
 * every matching device address (deduplicated). More than one entry means
 * the location text is shared by multiple devices — ambiguous.
 */
export async function findAllDeviceAddressesByLocationText(locationText) {
  const matches = await findAllAssetsListDocsByLocationText(locationText);
  const addresses = [];
  const seen = new Set();
  for (const match of matches) {
    const address =
      resolveAssetDeviceAddress(match.data) || match.data.deviceAddress || match.id || "";
    if (address && !seen.has(address)) {
      seen.add(address);
      addresses.push(address);
    }
  }
  return collapseUnprefixedDuplicates(addresses);
}

/**
 * The same device is sometimes stored twice — once with its panel prefix
 * ("2:M1-2-0") and once without ("M1-2-0"). Drop the unprefixed copy when
 * exactly one prefixed address has the same device part, so one physical
 * device is not reported as an ambiguous multi-device location. An unprefixed
 * address that matches several panels (or none) is kept as is.
 */
function collapseUnprefixedDuplicates(addresses) {
  const prefixedByDevice = new Map();
  for (const address of addresses) {
    const m = /^(\d+):(.+)$/.exec(address);
    if (!m) continue;
    const device = m[2].toUpperCase();
    prefixedByDevice.set(device, (prefixedByDevice.get(device) || 0) + 1);
  }
  return addresses.filter((address) => {
    if (/^\d+:/.test(address)) return true;
    return prefixedByDevice.get(address.toUpperCase()) !== 1;
  });
}

/**
 * Match a fire-panel-printed location string against AssetsList and return the
 * matched asset's floor-plan placement details (building, floor, section,
 * subsection, etc.), or null when nothing matches / the asset isn't placed.
 */
export async function findFloorDetailsByLocationText(locationText) {
  const match = await findAssetsListDocByLocationText(locationText);
  if (!match) return null;
  return extractFloorDetailsFromAsset(match.data, match.id);
}

/**
 * Update an asset's location or description in the address → floor details cache in-place.
 */
export function updateAssetInAddressFloorIndex({
  assetId = "",
  deviceAddress = "",
  deviceLocation,
  deviceDescription,
} = {}) {
  if (!floorIndexRef) return;
  const id = String(assetId || "").trim();
  const address = String(deviceAddress || "").trim();

  const updateDetailsObj = (details) => {
    if (!details) return;
    if (deviceLocation !== undefined) {
      details.deviceLocation = String(deviceLocation || "").trim();
    }
    if (deviceDescription !== undefined) {
      details.deviceDescription = String(deviceDescription || "").trim();
    }
    if (address) {
      details.address = address;
    }
  };

  if (id && floorIndexRef.byAssetId?.has(id)) {
    updateDetailsObj(floorIndexRef.byAssetId.get(id));
  }

  const dummyAsset = { deviceAddress: address, id };
  const keys = collectAssetAddressMatchKeys(dummyAsset, id);
  for (const key of keys) {
    if (floorIndexRef.byAddress?.has(key)) {
      updateDetailsObj(floorIndexRef.byAddress.get(key));
    }
  }
}

/** Apply an optional building hint when the AssetsList row omitted building. */
export function withBuildingHintOnFloorDetails(details, buildingHint = "") {
  if (!details) return null;
  if (details.building) return details;
  const hint = normalizeBuildingName(buildingHint);
  if (!hint) return details;
  return { ...details, building: hint };
}

/**
 * Build (or reuse) Map: addressKey → floor details from the AssetsList snapshot.
 * One pass over AssetsList — later lookups are O(1).
 */
export async function getAddressFloorDetailsIndex() {
  const snapshot = await getAssetsListSnapshot(db);

  // Same snapshot instance → reuse the built Map (no rebuild).
  if (floorIndexRef?.snapshot === snapshot && floorIndexRef?.byAddress) {
    reapplyLivePlans(floorIndexRef);
    return floorIndexRef;
  }

  if (floorIndexPromise) return floorIndexPromise;

  floorIndexPromise = (async () => {
    const byAddress = new Map();
    const byAssetId = new Map();
    const rows = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data() || {};
      const row = { id: docSnap.id, data };
      rows.push(row);

      const details = extractFloorDetailsFromAsset(data, docSnap.id);
      if (!details) continue;

      byAssetId.set(docSnap.id, details);

      for (const key of collectAssetAddressMatchKeys(data, docSnap.id)) {
        // First write wins for AssetsList — live plans overwrite below.
        if (!byAddress.has(key)) byAddress.set(key, details);
      }
    }

    const built = { snapshot, byAddress, byAssetId, rows };
    // Open plan markers overwrite AssetsList misses (no floorId on the row).
    reapplyLivePlans(built);
    floorIndexRef = built;
    floorIndexPromise = null;
    return built;
  })();

  try {
    return await floorIndexPromise;
  } catch (error) {
    floorIndexPromise = null;
    throw error;
  }
}

/** Prefetch AssetsList + build the address → floor Map (call on app/search mount). */
export async function warmAddressFloorDetailsIndex() {
  try {
    await getAddressFloorDetailsIndex();
  } catch (error) {
    console.warn("[asset search] failed to warm address→floor index:", error);
  }
}

/**
 * O(1) lookup: device address (or asset id) → cached floor details.
 * Tries every expanded address key (2:M1-1-0, M1-1-0, …).
 */
export function lookupFloorDetailsByAddress(index, addressOrId = "") {
  if (!index) return null;
  const token = String(addressOrId || "").trim();
  if (!token) return null;

  // Direct asset id hit.
  if (index.byAssetId?.has(token)) {
    return index.byAssetId.get(token);
  }

  for (const key of expandPanelAddressMatchKeys(token)) {
    const hit = index.byAddress.get(key);
    if (hit) return hit;
  }

  return null;
}

/**
 * Resolve floor details for a search result using the cached Map.
 * Falls back to fields already on the AssetsList row when the Map misses.
 */
export function resolveFloorDetailsFromCache(
  index,
  asset = {},
  docId = "",
  buildingHint = "",
) {
  const fromRow = extractFloorDetailsFromAsset(asset, docId);
  const address =
    resolveAssetDeviceAddress(asset) ||
    String(asset.deviceAddress || "").trim() ||
    "";

  const fromMap =
    lookupFloorDetailsByAddress(index, docId) ||
    lookupFloorDetailsByAddress(index, address) ||
    null;

  // Prefer Map entry (built at warm time); merge row fields if Map is thinner.
  const merged = fromMap
    ? {
        ...fromRow,
        ...fromMap,
        floorName: fromMap.floorName || fromRow?.floorName || "",
        sectionName: fromMap.sectionName || fromRow?.sectionName || "",
        subsectionName: fromMap.subsectionName || fromRow?.subsectionName || "",
        deviceLocation: fromMap.deviceLocation || fromRow?.deviceLocation || "",
        deviceDescription: fromMap.deviceDescription || fromRow?.deviceDescription || "",
        building: fromMap.building || fromRow?.building || "",
      }
    : fromRow;

  return withBuildingHintOnFloorDetails(merged, buildingHint);
}

/**
 * Push markers from an open floor plan into the address → floor Map.
 * Needed when AssetsList rows are missing floorId/sectionId but the asset
 * is already placed in nested assetMappings (visible on the plan).
 */
export function registerPlacedMappingsInAddressFloorIndex({
  building = "",
  floorId = "",
  floorName = "",
  sectionId = "",
  sectionName = "",
  subsectionId = "",
  subsectionName = "",
  mappings = [],
} = {}) {
  const normalizedBuilding = normalizeBuildingName(building);
  if (!normalizedBuilding || !floorId || !sectionId) return 0;

  const plan = {
    building: normalizedBuilding,
    floorId,
    floorName: floorName || floorId,
    sectionId,
    sectionName: sectionName || sectionId,
    subsectionId: subsectionId || "",
    subsectionName: subsectionName || "",
    mappings: Array.isArray(mappings) ? mappings : [],
  };

  livePlanEntries.set(planKey(plan), plan);

  const index = ensureIndexShell();
  return applyPlanMappingsToMaps(index.byAddress, index.byAssetId, plan);
}
