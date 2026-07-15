import FirestoreService from "@/services/firestoreService";
import { assetMatchesDeviceQuery } from "@/lib/assetDeviceSearch";
import {
  buildFloorPlanViewUrl,
  getFireDeviceNavigationTarget,
} from "@/lib/fireAlertFloorNavigation";
import { buildGraphicsViewUrl } from "@/lib/graphicsViewSelection";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { pickerAssetMatchesMapping } from "@/lib/floorMapAssets";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

const placementCache = new Map();

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
  if (pickerAssetMatchesMapping(assetRef, mapping)) return true;

  const mappingAddress = resolveAssetDeviceAddress(mapping);
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
      resolveAssetDeviceAddress(mapping || {}) ||
      resolveAssetDeviceAddress(assetRef) ||
      "",
    floorName: floor.name || mapping?.floorName || assetRef.floorName || "",
    sectionName: section.name || mapping?.sectionName || assetRef.sectionName || "",
    subsectionName:
      subsection?.name || mapping?.subsectionName || assetRef.subsectionName || "",
  };
}

/**
 * Resolve floor/section ids from names already stored on the AssetsList row.
 * A few list reads — much faster than scanning every plan's asset mappings.
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

  // Already have ids — no need to scan mappings.
  if (hintFloorId && hintSectionId) {
    return {
      building,
      floorId: hintFloorId,
      sectionId: hintSectionId,
      subsectionId: hintSubsectionId || "",
      assetId: assetRef.id || assetRef.assetsListId || assetRef.assetId || "",
      address: assetRef.deviceAddress || resolveAssetDeviceAddress(assetRef) || "",
      floorName: hintFloorName,
      sectionName: hintSectionName,
      subsectionName: hintSubsectionName,
    };
  }

  if (!hintFloorId && !hintFloorName) return null;

  const floors = await FirestoreService.getNestedFloors(building);
  const floor =
    floors.find((item) => item.id === hintFloorId) ||
    floors.find((item) => namesEqual(item.name, hintFloorName));
  if (!floor) return null;

  // Have floor+section ids after resolving names.
  if (hintSectionId || hintSectionName) {
    const sections = await FirestoreService.getNestedSections(building, floor.id);
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

/** Search one section (and its subsections) for the asset — runs in parallel with siblings. */
async function findInSection(building, floor, section, assetRef) {
  const [sectionMappings, subsections] = await Promise.all([
    FirestoreService.getSectionAssetMappings(building, floor.id, section.id),
    FirestoreService.getNestedSubsections(building, floor.id, section.id),
  ]);

  const sectionMatch = sectionMappings.find((mapping) =>
    mappingMatchesAsset(mapping, assetRef),
  );
  if (sectionMatch) {
    return buildPlacementTarget(building, floor, section, null, sectionMatch, assetRef);
  }

  if (!subsections.length) return null;

  const subsectionHits = await Promise.all(
    subsections.map(async (subsection) => {
      const subsectionMappings = await FirestoreService.getSubsectionAssetMappings(
        building,
        floor.id,
        section.id,
        subsection.id,
      );
      const match = subsectionMappings.find((mapping) =>
        mappingMatchesAsset(mapping, assetRef),
      );
      if (!match) return null;
      return buildPlacementTarget(
        building,
        floor,
        section,
        subsection,
        match,
        assetRef,
      );
    }),
  );

  return subsectionHits.find(Boolean) || null;
}

/** Search one floor's sections in parallel. */
async function findInFloor(building, floor, assetRef) {
  const sections = await FirestoreService.getNestedSections(building, floor.id);
  if (!sections.length) return null;

  const hits = await Promise.all(
    sections.map((section) => findInSection(building, floor, section, assetRef)),
  );
  return hits.find(Boolean) || null;
}

/** Walk nested floor plans to find where an asset is placed (parallelized). */
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

  // Hint-based resolve first (names/ids on AssetsList) — usually 1–3 reads.
  const fromHints = await findPlacementFromAssetHints(building, assetRef);
  if (fromHints?.floorId && fromHints?.sectionId) {
    placementCache.set(cacheKey, fromHints);
    return fromHints;
  }

  const floors = await FirestoreService.getNestedFloors(building);
  if (!floors.length) {
    placementCache.set(cacheKey, null);
    return null;
  }

  // Search all floors at once instead of one-by-one.
  const hits = await Promise.all(
    floors.map((floor) => findInFloor(building, floor, assetRef)),
  );
  const target = hits.find(Boolean) || null;
  placementCache.set(cacheKey, target);
  return target;
}

/** Resolve a full graphics-view navigation target for an asset. */
export async function resolveAssetNavigationTarget(asset = {}, docId = "") {
  const assetRef = buildAssetRef(asset, docId);
  const building = normalizeBuildingName(assetRef.buildingName || assetRef.building || "");

  const directTarget = getFireDeviceNavigationTarget({
    ...assetRef,
    buildingName: building,
    building,
  });
  if (directTarget) {
    return {
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
    };
  }

  if (!building) return null;

  // Try resolving names → ids before the full mapping scan.
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
  const parts = [];
  if (target.building) parts.push(`Building: ${target.building}`);
  if (target.floorName) parts.push(`Floor: ${target.floorName}`);
  if (target.sectionName) parts.push(`Section: ${target.sectionName}`);
  if (target.subsectionName) parts.push(`Subsection: ${target.subsectionName}`);
  return parts.join(" · ") || "Not placed on a floor plan";
}
