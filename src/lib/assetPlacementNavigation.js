import { collection, getDocs } from "firebase/firestore";
import { db } from "@/config/firebase";
import FirestoreService from "@/services/firestoreService";
import { assetMatchesDeviceQuery } from "@/lib/assetDeviceSearch";
import {
  getAddressFloorDetailsIndex,
  resolveFloorDetailsFromCache,
} from "@/lib/assetAddressFloorIndex";
import {
  buildFloorPlanViewUrl,
  getFireDeviceNavigationTarget,
} from "@/lib/fireAlertFloorNavigation";
import { buildGraphicsViewUrl } from "@/lib/graphicsViewSelection";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { buildingCollectionName } from "@/lib/nestedFloorPlan";
import {
  getAssetsListIdFromMapping,
  pickerAssetMatchesMapping,
  resolveMappingDeviceFields,
} from "@/lib/floorMapAssets";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

const placementCache = new Map();
const floorsCache = new Map();
const sectionsCache = new Map();

/** Clear cached placement lookups (call after place/remove). */
export function clearAssetPlacementCache() {
  placementCache.clear();
  floorsCache.clear();
  sectionsCache.clear();
}

function namesEqual(left = "", right = "") {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function buildAssetRef(asset = {}, docId = "") {
  const id = String(docId || asset.id || "").trim();
  return {
    ...asset,
    id,
    assetsListId: asset.assetsListId || id,
    deviceAddress: resolveAssetDeviceAddress(asset),
  };
}

function mappingMatchesAsset(mapping = {}, assetRef = {}) {
  const mappingListId = getAssetsListIdFromMapping(mapping);
  const assetListId = String(assetRef.assetsListId || assetRef.id || "").trim();

  if (assetListId && mappingListId && assetListId === String(mappingListId)) {
    return true;
  }
  if (assetListId && mapping.id && assetListId === String(mapping.id)) {
    return true;
  }

  if (pickerAssetMatchesMapping({ ...assetRef, assetMode: "general" }, mapping)) {
    return true;
  }
  if (pickerAssetMatchesMapping(assetRef, mapping)) {
    return true;
  }

  const mappingAddress =
    resolveMappingDeviceFields(mapping).deviceAddress ||
    resolveAssetDeviceAddress(mapping);
  if (
    mappingAddress &&
    assetRef.deviceAddress &&
    assetMatchesDeviceQuery({ deviceAddress: mappingAddress }, assetRef.deviceAddress)
  ) {
    return true;
  }

  return false;
}

function buildPlacementTarget(buildingName, floor, section, subsection, mapping, assetRef) {
  const placementLevel =
    mapping?.placementLevel || (subsection?.id || mapping?.subsectionId ? "subsection" : "section");

  return {
    building: normalizeBuildingName(buildingName),
    floorId: floor.id,
    sectionId: section.id,
    subsectionId:
      placementLevel === "subsection" ? subsection?.id || mapping?.subsectionId || "" : "",
    assetId: mapping?.assetsListId || mapping?.id || assetRef.id || "",
    address:
      resolveMappingDeviceFields(mapping || {}).deviceAddress ||
      resolveAssetDeviceAddress(mapping || {}) ||
      resolveAssetDeviceAddress(assetRef) ||
      "",
    // Prefer real names; fall back to ids (often "1F", "Plan_1") — avoids extra reads.
    floorName: floor.name || mapping?.floorName || assetRef.floorName || floor.id || "",
    sectionName:
      section.name || mapping?.sectionName || assetRef.sectionName || section.id || "",
    subsectionName:
      subsection?.name ||
      mapping?.subsectionName ||
      assetRef.subsectionName ||
      subsection?.id ||
      "",
  };
}

/** Fill display names from ids when AssetsList omitted floorName/sectionName. */
function withFallbackPlacementNames(target = {}) {
  if (!target) return target;
  return {
    ...target,
    floorName: target.floorName || target.floorId || "",
    sectionName: target.sectionName || target.sectionId || "",
    subsectionName: target.subsectionName || target.subsectionId || "",
  };
}

async function getCachedFloors(building) {
  if (floorsCache.has(building)) return floorsCache.get(building);
  const floors = await FirestoreService.getNestedFloors(building);
  floorsCache.set(building, floors);
  return floors;
}

async function getCachedSections(building, floorId) {
  const key = `${building}::${floorId}`;
  if (sectionsCache.has(key)) return sectionsCache.get(key);
  const sections = await FirestoreService.getNestedSections(building, floorId);
  sectionsCache.set(key, sections);
  return sections;
}

/**
 * Lightweight mapping read for search — skips the AssetsList merge used by the view page.
 * Much faster when scanning many sections to locate one asset.
 */
async function getSectionMappingsLite(buildingName, floorId, sectionId) {
  const coll = buildingCollectionName(buildingName);
  const mappingsRef = collection(
    db,
    coll,
    "floorMaps",
    "floors",
    floorId,
    "sections",
    sectionId,
    "assetMappings",
  );
  const snap = await getDocs(mappingsRef);
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

async function getSubsectionMappingsLite(
  buildingName,
  floorId,
  sectionId,
  subsectionId,
) {
  const coll = buildingCollectionName(buildingName);
  const mappingsRef = collection(
    db,
    coll,
    "floorMaps",
    "floors",
    floorId,
    "sections",
    sectionId,
    "subsections",
    subsectionId,
    "assetMappings",
  );
  const snap = await getDocs(mappingsRef);
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

/**
 * Resolve floor/section ids from names already stored on the AssetsList row.
 * Fast path — no mapping scan.
 */
async function findPlacementFromAssetHints(buildingName, assetRef) {
  const building = normalizeBuildingName(buildingName);
  if (!building) return null;

  const hintFloorId = assetRef.floorId || assetRef.floorDetails?.id || "";
  const hintSectionId = assetRef.sectionId || assetRef.sectionDetails?.id || "";
  const hintSubsectionId = assetRef.subsectionId || assetRef.subsectionDetails?.id || "";
  const hintFloorName = assetRef.floorName || assetRef.floorDetails?.name || "";
  const hintSectionName = assetRef.sectionName || assetRef.sectionDetails?.name || "";
  const hintSubsectionName =
    assetRef.subsectionName || assetRef.subsectionDetails?.name || "";

  // Already have ids — use names from the asset or fall back to ids (no Firestore).
  if (hintFloorId && hintSectionId) {
    return withFallbackPlacementNames({
      building,
      floorId: hintFloorId,
      sectionId: hintSectionId,
      subsectionId: hintSubsectionId || "",
      assetId: assetRef.id || assetRef.assetsListId || assetRef.assetId || "",
      address: assetRef.deviceAddress || resolveAssetDeviceAddress(assetRef) || "",
      floorName: hintFloorName,
      sectionName: hintSectionName,
      subsectionName: hintSubsectionName,
    });
  }

  if (!hintFloorId && !hintFloorName) return null;

  const floors = await getCachedFloors(building);
  const floor =
    floors.find((item) => item.id === hintFloorId) ||
    floors.find((item) => namesEqual(item.name, hintFloorName));
  if (!floor) return null;

  if (hintSectionId || hintSectionName) {
    const sections = await getCachedSections(building, floor.id);
    const section =
      sections.find((item) => item.id === hintSectionId) ||
      sections.find((item) => namesEqual(item.name, hintSectionName));
    if (!section) return null;

    let subsection = null;
    if (hintSubsectionId || hintSubsectionName) {
      const subsections = await FirestoreService.getNestedSubsections(
        building,
        floor.id,
        section.id,
      );
      subsection =
        subsections.find((item) => item.id === hintSubsectionId) ||
        subsections.find((item) => namesEqual(item.name, hintSubsectionName)) ||
        null;
    }

    return buildPlacementTarget(
      building,
      floor,
      section,
      subsection,
      {
        placementLevel: subsection ? "subsection" : "section",
        subsectionId: subsection?.id || "",
        assetsListId: assetRef.assetsListId || assetRef.id,
        id: assetRef.id,
        floorName: floor.name,
        sectionName: section.name,
        subsectionName: subsection?.name || "",
      },
      assetRef,
    );
  }

  return null;
}

/** Search one section (and subsections) — lite reads, stop at first hit. */
async function findInSection(building, floor, section, assetRef) {
  const sectionMappings = await getSectionMappingsLite(building, floor.id, section.id);
  const sectionMatch = sectionMappings.find((mapping) =>
    mappingMatchesAsset(mapping, assetRef),
  );
  if (sectionMatch) {
    return buildPlacementTarget(building, floor, section, null, sectionMatch, assetRef);
  }

  // Only load subsections if the section itself had no match.
  const subsections = await FirestoreService.getNestedSubsections(
    building,
    floor.id,
    section.id,
  );
  if (!subsections.length) return null;

  for (const subsection of subsections) {
    const subsectionMappings = await getSubsectionMappingsLite(
      building,
      floor.id,
      section.id,
      subsection.id,
    );
    const match = subsectionMappings.find((mapping) =>
      mappingMatchesAsset(mapping, assetRef),
    );
    if (match) {
      return buildPlacementTarget(
        building,
        floor,
        section,
        subsection,
        match,
        assetRef,
      );
    }
  }

  return null;
}

/** Search one floor's sections — stop at the first matching section. */
async function findInFloor(building, floor, assetRef) {
  const sections = await getCachedSections(building, floor.id);
  if (!sections.length) return null;

  // Sequential per section so we stop early instead of flooding Firestore.
  for (const section of sections) {
    const hit = await findInSection(building, floor, section, assetRef);
    if (hit) return hit;
  }
  return null;
}

/** Walk nested floor plans to find where an asset is placed. */
export async function findAssetPlacementInBuilding(buildingName, asset = {}, docId = "") {
  const building = normalizeBuildingName(buildingName || asset.buildingName || asset.building || "");
  const assetRef = buildAssetRef(asset, docId);
  if (!building) return null;

  const cacheKey = `${building}::${assetRef.deviceAddress || assetRef.id}`;
  if (placementCache.has(cacheKey)) {
    const cached = placementCache.get(cacheKey);
    if (cached && !cached.address && assetRef.deviceAddress) {
      return { ...cached, address: assetRef.deviceAddress };
    }
    return cached;
  }

  const fromHints = await findPlacementFromAssetHints(building, assetRef);
  if (fromHints?.floorId && fromHints?.sectionId) {
    placementCache.set(cacheKey, fromHints);
    return fromHints;
  }

  const floors = await getCachedFloors(building);
  if (!floors.length) {
    return null;
  }

  // Search floors one at a time and stop on first hit (faster than scanning everything).
  for (const floor of floors) {
    const hit = await findInFloor(building, floor, assetRef);
    if (hit) {
      placementCache.set(cacheKey, hit);
      return hit;
    }
  }

  return null;
}

/** Resolve a full graphics-view navigation target for an asset. */
export async function resolveAssetNavigationTarget(asset = {}, docId = "") {
  const assetRef = buildAssetRef(asset, docId);
  const building = normalizeBuildingName(assetRef.buildingName || assetRef.building || "");

  // Fast path: warmed address → floor details Map (built from AssetsList once).
  try {
    const floorIndex = await getAddressFloorDetailsIndex();
    const cached = resolveFloorDetailsFromCache(
      floorIndex,
      assetRef,
      assetRef.id,
      building,
    );
    if (cached?.building && cached?.floorId && cached?.sectionId) {
      return withFallbackPlacementNames(cached);
    }
  } catch (error) {
    console.warn("[asset placement] address floor index lookup failed:", error);
  }

  const directTarget = getFireDeviceNavigationTarget({
    ...assetRef,
    buildingName: building,
    building,
  });
  if (directTarget) {
    // Fast — no Firestore name lookups; ids work as labels when names are missing.
    return withFallbackPlacementNames({
      ...directTarget,
      floorName: assetRef.floorName || assetRef.floorDetails?.name || "",
      sectionName: assetRef.sectionName || assetRef.sectionDetails?.name || "",
      subsectionName:
        assetRef.subsectionName || assetRef.subsectionDetails?.name || "",
      address:
        directTarget.address ||
        assetRef.deviceAddress ||
        resolveAssetDeviceAddress(assetRef) ||
        "",
    });
  }

  if (!building) return null;

  const fromHints = await findPlacementFromAssetHints(building, assetRef);
  if (fromHints?.floorId && fromHints?.sectionId) {
    return fromHints;
  }

  return findAssetPlacementInBuilding(building, assetRef, assetRef.id);
}

/** Build the graphics view URL for an asset, resolving placement when needed. */
export async function resolveAssetNavigationUrl(asset = {}, docId = "") {
  const building = normalizeBuildingName(asset.buildingName || asset.building || "");
  const target = await resolveAssetNavigationTarget(asset, docId);

  if (target?.building && target.floorId && target.sectionId) {
    return buildFloorPlanViewUrl(target);
  }

  if (building) {
    return buildGraphicsViewUrl({ building });
  }

  return "/dashboard/floor_configuration/view";
}

/** Format placement labels once a target is resolved. */
export function formatPlacementTargetLabel(target = {}) {
  const named = withFallbackPlacementNames(target);
  const parts = [];
  if (named.building) parts.push(`Building: ${named.building}`);
  if (named.floorName) parts.push(`Floor: ${named.floorName}`);
  if (named.sectionName) parts.push(`Section: ${named.sectionName}`);
  if (named.subsectionName) parts.push(`Subsection: ${named.subsectionName}`);
  return parts.join(" · ") || "Not placed on a floor plan";
}

/** True when a location summary already includes Building + Floor (or Section). */
export function locationSummaryHasPlacementHierarchy(summary = "") {
  const text = String(summary || "");
  return (
    text.includes("Building:") &&
    (text.includes("Floor:") || text.includes("Section:"))
  );
}
