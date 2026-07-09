import * as XLSX from "xlsx";
import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import FirestoreService from "@/services/firestoreService";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";
import {
  pickMappingDeviceFields,
  pickerAssetMatchesMapping,
  buildingsMatch,
} from "@/lib/floorMapAssets";
import {
  sanitizeFloorPlanId,
  computeCoordinateBounds,
  csvCoordsToRelativePlacement,
} from "@/lib/nestedFloorPlan";

/** Standard CSV columns for floor-plan placement export / restore. */
export const PLACEMENT_CSV_COLUMNS = [
  "deviceAddress",
  "deviceLocation",
  "assetName",
  "itemType",
  "category",
  "buildingAssetId",
  "assetMode",
  "placementLevel",
  "buildingName",
  "floorId",
  "floorName",
  "sectionId",
  "sectionName",
  "subsectionId",
  "subsectionName",
  "nestedPath",
  "floorPlanName",
  "x",
  "y",
  "relativeX",
  "relativeY",
  "coordinateX",
  "coordinateY",
  "coordinateZ",
  "globalId",
];

const CSV_KEY_ALIASES = {
  deviceaddress: "deviceAddress",
  fa_device_address: "deviceAddress",
  device_address: "deviceAddress",
  x: "x",
  y: "y",
  floor: "floorName",
  block: "blockReference",
  devicelocation: "deviceLocation",
  assetname: "assetName",
  itemtype: "itemType",
  buildingassetid: "buildingAssetId",
  assetmode: "assetMode",
  placementlevel: "placementLevel",
  buildingname: "buildingName",
  floorid: "floorId",
  floorname: "floorName",
  sectionid: "sectionId",
  sectionname: "sectionName",
  subsectionid: "subsectionId",
  subsectionname: "subsectionName",
  nestedpath: "nestedPath",
  floorplanname: "floorPlanName",
  relativex: "relativeX",
  relativey: "relativeY",
  coordinatex: "coordinateX",
  coordinatey: "coordinateY",
  coordinatez: "coordinateZ",
  globalid: "globalId",
};

function normalizeDeviceAddressKey(value) {
  const resolved = resolveAssetDeviceAddress({ deviceAddress: value }) || String(value || "").trim();
  return resolved.toLowerCase();
}

function parseNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeImportRow(row = {}) {
  const normalized = {};
  Object.entries(row).forEach(([key, value]) => {
    const cleanKey = String(key || "").trim();
    const alias = CSV_KEY_ALIASES[cleanKey.toLowerCase()] || cleanKey;
    normalized[alias] = value;
  });
  return normalized;
}

/** Normalize DXF/device-location CSV rows (deviceAddress, X, Y, Floor, Block). */
export function normalizeLocationCsvRow(row = {}) {
  const normalized = normalizeImportRow(row);

  if (normalized.x === undefined && normalized.X !== undefined) normalized.x = normalized.X;
  if (normalized.y === undefined && normalized.Y !== undefined) normalized.y = normalized.Y;
  if (!normalized.floorName && normalized.Floor) normalized.floorName = normalized.Floor;
  if (!normalized.blockReference && normalized.Block) {
    normalized.blockReference = String(normalized.Block).trim();
  }
  if (!normalized.deviceLocation && normalized.blockReference) {
    normalized.deviceLocation = normalized.blockReference;
  }

  return normalized;
}

function mappingToExportRow(mapping, buildingName, assetDetails = {}) {
  const deviceFields = pickMappingDeviceFields({ ...assetDetails, ...mapping });
  const coords = assetDetails.coordinates || mapping.coordinates || {};

  return {
    deviceAddress: deviceFields.deviceAddress || "",
    deviceLocation: deviceFields.deviceLocation || "",
    assetName: mapping.assetName || assetDetails.assetName || assetDetails.name || "",
    itemType: mapping.itemType || assetDetails.itemType || "",
    category: mapping.category || assetDetails.category || "",
    buildingAssetId: mapping.buildingAssetId || assetDetails.id || "",
    assetMode: mapping.assetMode || assetDetails.assetMode || "building",
    placementLevel: mapping.placementLevel || "",
    buildingName: mapping.buildingName || mapping.building || buildingName || "",
    floorId: mapping.floorId || "",
    floorName: mapping.floorName || "",
    sectionId: mapping.sectionId || "",
    sectionName: mapping.sectionName || "",
    subsectionId: mapping.subsectionId || "",
    subsectionName: mapping.subsectionName || "",
    nestedPath: mapping.nestedPath || "",
    floorPlanName: mapping.floorPlanName || mapping.floorMapName || "",
    x: mapping.x ?? "",
    y: mapping.y ?? "",
    relativeX: mapping.relativeX ?? "",
    relativeY: mapping.relativeY ?? "",
    coordinateX: coords.x ?? "",
    coordinateY: coords.y ?? "",
    coordinateZ: coords.z ?? "",
    globalId: assetDetails.globalId || mapping.globalId || "",
  };
}

/** Collect every nested section / subsection placement for a building. */
export async function collectFloorPlanPlacementRows(buildingName) {
  if (!buildingName) return [];

  const floors = await FirestoreService.getNestedFloors(buildingName);
  const buildingAssetsResult = await FirestoreService.getBuildingAssets(buildingName);
  const assetDetailsById = new Map();

  Object.entries(buildingAssetsResult.categories || {}).forEach(([categoryKey, category]) => {
    Object.entries(category.assets || {}).forEach(([assetId, asset]) => {
      assetDetailsById.set(`${categoryKey}::${assetId}`, {
        ...asset,
        category: categoryKey,
        assetMode: "building",
      });
    });
  });

  const rows = [];
  const seen = new Set();

  for (const floor of floors) {
    const sections = await FirestoreService.getNestedSections(buildingName, floor.id);
    for (const section of sections) {
      const sectionMappings = await FirestoreService.getSectionAssetMappings(
        buildingName,
        floor.id,
        section.id,
      );
      for (const mapping of sectionMappings) {
        const key = `${mapping.id || mapping.assetName}::${mapping.x}::${mapping.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const detailsKey = `${mapping.category}::${mapping.buildingAssetId || ""}`;
        rows.push(
          mappingToExportRow(
            { ...mapping, floorId: mapping.floorId || floor.id, floorName: mapping.floorName || floor.name, sectionId: mapping.sectionId || section.id, sectionName: mapping.sectionName || section.name },
            buildingName,
            assetDetailsById.get(detailsKey) || {},
          ),
        );
      }

      const subsections = await FirestoreService.getNestedSubsections(
        buildingName,
        floor.id,
        section.id,
      );
      for (const subsection of subsections) {
        const subsectionMappings = await FirestoreService.getSubsectionAssetMappings(
          buildingName,
          floor.id,
          section.id,
          subsection.id,
        );
        for (const mapping of subsectionMappings) {
          const key = `${mapping.id || mapping.assetName}::${mapping.x}::${mapping.y}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const detailsKey = `${mapping.category}::${mapping.buildingAssetId || ""}`;
          rows.push(
            mappingToExportRow(
              {
                ...mapping,
                floorId: mapping.floorId || floor.id,
                floorName: mapping.floorName || floor.name,
                sectionId: mapping.sectionId || section.id,
                sectionName: mapping.sectionName || section.name,
                subsectionId: mapping.subsectionId || subsection.id,
                subsectionName: mapping.subsectionName || subsection.name,
                placementLevel: mapping.placementLevel || "subsection",
              },
              buildingName,
              assetDetailsById.get(detailsKey) || {},
            ),
          );
        }
      }
    }
  }

  // Include building assets with placement fields but missing from mapping collections.
  assetDetailsById.forEach((asset) => {
    if (!asset.floorId && !asset.sectionId && !asset.nestedPath) return;
    if (typeof asset.x !== "number" || typeof asset.y !== "number") return;

    const deviceAddress = resolveAssetDeviceAddress(asset);
    const duplicate = rows.some(
      (row) =>
        normalizeDeviceAddressKey(row.deviceAddress) === normalizeDeviceAddressKey(deviceAddress) &&
        String(row.floorId) === String(asset.floorId || "") &&
        String(row.sectionId) === String(asset.sectionId || "") &&
        String(row.subsectionId || "") === String(asset.subsectionId || ""),
    );
    if (duplicate) return;

    rows.push(mappingToExportRow(asset, buildingName, asset));
  });

  return rows.sort((a, b) =>
    String(a.deviceAddress || "").localeCompare(String(b.deviceAddress || "")),
  );
}

export function downloadFloorPlanPlacementCsv(buildingName, rows) {
  const worksheet = XLSX.utils.json_to_sheet(rows, { header: PLACEMENT_CSV_COLUMNS });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Placements");
  const safeName = String(buildingName || "building").replace(/[^\w.-]+/g, "_");
  XLSX.writeFile(workbook, `${safeName}_floor_plan_placements.csv`);
}

export async function parseFloorPlanPlacementCsvFile(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
  return rawRows
    .map(normalizeLocationCsvRow)
    .filter((row) => String(row.deviceAddress || "").trim());
}

function findAssetByDeviceAddress(assets, deviceAddress) {
  const target = normalizeDeviceAddressKey(deviceAddress);
  if (!target) return null;
  return (
    assets.find((asset) => {
      const candidates = [
        resolveAssetDeviceAddress(asset),
        asset.deviceAddress,
        asset.partNumber,
      ]
        .filter(Boolean)
        .map(normalizeDeviceAddressKey);
      return candidates.includes(target);
    }) || null
  );
}

/** Uploaded (general) assets from AssetsList for a building. */
export async function collectUploadedGeneralAssets(buildingName) {
  if (!buildingName) return [];

  const snap = await getDocs(collection(db, "AssetsList"));
  const items = [];

  snap.forEach((docSnap) => {
    const data = docSnap.data();

    items.push({
      id: docSnap.id,
      assetsListId: docSnap.id,
      name: data.itemType || data.assetName || data.description || docSnap.id,
      assetName: data.assetName || data.itemType || data.description || docSnap.id,
      itemType: data.itemType || data.assetName || "",
      category: data.system || data.category || data.categoryKey || "fire-life-safety",
      categoryKey: data.categoryKey || data.category || data.system || "fire-life-safety",
      assetMode: "general",
      ...pickMappingDeviceFields(data),
      deviceLocation: data.deviceLocation || "",
      coordinates: data.coordinates || null,
      globalId: data.globalId || "",
    });
  });

  return items;
}

async function updateAssetCoordinatesFromRow(buildingName, asset, row) {
  const coordX = parseNumber(row.coordinateX);
  const coordY = parseNumber(row.coordinateY);
  const coordZ = parseNumber(row.coordinateZ);
  if (coordX === null && coordY === null && coordZ === null && !row.globalId) {
    return false;
  }

  const payload = {
    coordinates: {
      x: coordX ?? 0,
      y: coordY ?? 0,
      z: coordZ ?? 0,
    },
    coordinatesUpdatedAt: new Date().toISOString(),
  };
  if (row.globalId) payload.globalId = String(row.globalId);

  if ((asset.assetMode || "general") === "general") {
    await updateDoc(doc(db, "AssetsList", asset.assetsListId || asset.id), payload);
  } else {
    await FirestoreService.updateAssetCoordinates(
      buildingName,
      asset.category,
      asset.id,
      payload,
    );
  }

  return true;
}

async function resolvePlacementIds(buildingName, row) {
  const floors = await FirestoreService.getNestedFloors(buildingName);
  let floor =
    floors.find((f) => f.id === row.floorId) ||
    floors.find((f) => f.name?.toLowerCase() === String(row.floorName || "").toLowerCase()) ||
    floors.find((f) => f.id === sanitizeFloorPlanId(row.floorName));

  if (!floor) return null;

  const sections = await FirestoreService.getNestedSections(buildingName, floor.id);
  let section =
    sections.find((s) => s.id === row.sectionId) ||
    sections.find((s) => s.name?.toLowerCase() === String(row.sectionName || "").toLowerCase()) ||
    sections.find((s) => s.id === sanitizeFloorPlanId(row.sectionName)) ||
    sections.find(
      (s) => s.name?.toLowerCase() === String(row.blockReference || "").toLowerCase(),
    ) ||
    sections.find((s) => s.id === sanitizeFloorPlanId(row.blockReference));

  if (!section) return null;

  const placementLevel = row.placementLevel || (row.subsectionId || row.subsectionName ? "subsection" : "section");
  let subsection = null;

  if (placementLevel === "subsection") {
    const subsections = await FirestoreService.getNestedSubsections(
      buildingName,
      floor.id,
      section.id,
    );
    subsection =
      subsections.find((s) => s.id === row.subsectionId) ||
      subsections.find((s) => s.name?.toLowerCase() === String(row.subsectionName || "").toLowerCase()) ||
      subsections.find((s) => s.id === sanitizeFloorPlanId(row.subsectionName));
    if (!subsection) return null;
  }

  return { floor, section, subsection, placementLevel };
}

function applyCsvPlacementCoords(row, coordOptions) {
  const parsedRelativeX = parseNumber(row.relativeX);
  const parsedRelativeY = parseNumber(row.relativeY);
  if (parsedRelativeX !== null && parsedRelativeY !== null) {
    const { imageNaturalWidth = 0, imageNaturalHeight = 0 } = coordOptions || {};
    return {
      x:
        imageNaturalWidth > 0
          ? Math.round(parsedRelativeX * imageNaturalWidth)
          : parseNumber(row.x),
      y:
        imageNaturalHeight > 0
          ? Math.round(parsedRelativeY * imageNaturalHeight)
          : parseNumber(row.y),
      relativeX: parsedRelativeX,
      relativeY: parsedRelativeY,
    };
  }

  const rawX = parseNumber(row.x);
  const rawY = parseNumber(row.y);
  if (rawX === null || rawY === null) return null;

  const converted = csvCoordsToRelativePlacement(rawX, rawY, coordOptions);
  if (!converted) {
    return { x: rawX, y: rawY, relativeX: null, relativeY: null };
  }
  return converted;
}

function buildMappingFromImportRow(row, asset, buildingName, target, coordOptions = {}) {
  const { floor, section, subsection, placementLevel } = target;
  const pathParts = [buildingName, floor.name, section.name];
  if (placementLevel === "subsection" && subsection?.name) pathParts.push(subsection.name);

  const planParts = [floor.name, section.name];
  if (placementLevel === "subsection" && subsection?.name) planParts.push(subsection.name);

  const isGeneral = (asset.assetMode || "general") === "general";
  const coords = applyCsvPlacementCoords(row, coordOptions) || {
    x: parseNumber(row.x),
    y: parseNumber(row.y),
    relativeX: parseNumber(row.relativeX),
    relativeY: parseNumber(row.relativeY),
  };

  return {
    id: `asset_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    assetName: row.assetName || asset.assetName || asset.name || asset.itemType || "",
    itemType: row.itemType || asset.itemType || asset.assetName || "",
    category: row.category || asset.category || "fire-life-safety",
    assetMode: isGeneral ? "general" : "building",
    buildingAssetId: isGeneral ? null : asset.id,
    assetsListId: isGeneral ? asset.assetsListId || asset.id : null,
    x: coords.x,
    y: coords.y,
    relativeX: coords.relativeX,
    relativeY: coords.relativeY,
    ...pickMappingDeviceFields({
      ...asset,
      deviceAddress: row.deviceAddress,
      deviceLocation: row.deviceLocation || asset.deviceLocation,
    }),
    buildingName,
    building: buildingName,
    placementLevel,
    nestedPath: row.nestedPath || pathParts.filter(Boolean).join(" > "),
    floorPlanName: row.floorPlanName || planParts.filter(Boolean).join(" / "),
    floorMapName: row.floorPlanName || planParts.filter(Boolean).join(" / "),
    floorId: floor.id,
    floorName: floor.name,
    sectionId: section.id,
    sectionName: section.name,
    subsectionId: placementLevel === "subsection" ? subsection?.id || "" : "",
    subsectionName: placementLevel === "subsection" ? subsection?.name || "" : "",
    placedAt: new Date().toISOString(),
  };
}

function placementTargetKey(target) {
  const { floor, section, subsection, placementLevel } = target;
  return `${floor.id}::${section.id}::${placementLevel}::${placementLevel === "subsection" ? subsection?.id || "" : ""}`;
}

/**
 * Build section/subsection asset mappings from location CSV rows (editor preview, no Firestore write).
 * Matches deviceAddress to uploaded (general) assets only.
 */
export function buildMappingsFromLocationCsvRows(rows, options = {}) {
  const {
    assets = [],
    placementContext = null,
    generalAssetsOnly = true,
    filterToPlacementContext = true,
    imageNaturalSize = null,
  } = options;

  const imageNaturalWidth = imageNaturalSize?.naturalWidth || 0;
  const imageNaturalHeight = imageNaturalSize?.naturalHeight || 0;
  const csvBounds = computeCoordinateBounds(
    rows.map((row) => {
      const normalized = normalizeLocationCsvRow(row);
      return { x: parseNumber(normalized.x), y: parseNumber(normalized.y) };
    }),
  );
  const coordOptions = {
    bounds: csvBounds,
    imageNaturalWidth,
    imageNaturalHeight,
  };

  const matchAssets = generalAssetsOnly
    ? assets.filter((asset) => (asset.assetMode || "general") === "general")
    : assets;

  const unmatched = [];
  const skipped = [];
  const mappings = [];
  let mappingIndex = 0;

  for (const rawRow of rows) {
    const row = normalizeLocationCsvRow(rawRow);

    if (filterToPlacementContext && placementContext?.floorName && row.floorName) {
      const csvFloor = String(row.floorName).trim().toLowerCase();
      const currentFloor = String(placementContext.floorName).trim().toLowerCase();
      if (csvFloor !== currentFloor) continue;
    }

    const asset = findAssetByDeviceAddress(matchAssets, row.deviceAddress);
    if (!asset) {
      unmatched.push(row.deviceAddress);
      continue;
    }

    const assetsListId = asset.assetsListId || asset.id;
    if (!assetsListId) {
      skipped.push(row.deviceAddress);
      continue;
    }

    const x = parseNumber(row.x);
    const y = parseNumber(row.y);
    if (x === null || y === null) {
      skipped.push(row.deviceAddress);
      continue;
    }

    const coords = applyCsvPlacementCoords(row, coordOptions);
    if (!coords || coords.relativeX === null || coords.relativeY === null) {
      skipped.push(row.deviceAddress);
      continue;
    }

    mappings.push({
      id: `map_${assetsListId}_${mappingIndex++}`,
      assetName: row.assetName || asset.assetName || asset.name || asset.itemType || "",
      itemType: row.itemType || asset.itemType || asset.assetName || "",
      category: row.category || asset.category || "fire-life-safety",
      assetMode: "general",
      assetsListId,
      buildingAssetId: null,
      x: coords.x,
      y: coords.y,
      relativeX: coords.relativeX,
      relativeY: coords.relativeY,
      ...pickMappingDeviceFields({
        ...asset,
        deviceAddress: row.deviceAddress,
        deviceLocation: row.deviceLocation || asset.deviceLocation,
      }),
      ...(placementContext || {}),
      placedAt: new Date().toISOString(),
    });
  }

  return {
    mappings,
    unmatched,
    skipped,
    totalRows: rows.length,
    imported: mappings.length,
  };
}

/**
 * Restore floor-plan placements from CSV rows by matching deviceAddress to uploaded assets.
 */
export async function restoreFloorPlanPlacementsFromCsv(buildingName, rows, options = {}) {
  const {
    assets: providedAssets,
    onProgress,
    placementContext = null,
    imageNaturalSize = null,
  } = options;
  const imageNaturalWidth = imageNaturalSize?.naturalWidth || 0;
  const imageNaturalHeight = imageNaturalSize?.naturalHeight || 0;
  const csvBounds = computeCoordinateBounds(
    rows.map((row) => ({ x: parseNumber(row.x), y: parseNumber(row.y) })),
  );
  const coordOptions = {
    bounds: csvBounds,
    imageNaturalWidth,
    imageNaturalHeight,
  };
  const matchAssets =
    providedAssets?.length > 0
      ? providedAssets.filter((asset) => (asset.assetMode || "general") === "general")
      : await collectUploadedGeneralAssets(buildingName);
  const grouped = new Map();
  const unmatched = [];
  const skipped = [];

  for (const row of rows) {
    const asset = findAssetByDeviceAddress(matchAssets, row.deviceAddress);
    if (!asset) {
      unmatched.push(row.deviceAddress);
      continue;
    }

    const target = placementContext
      ? {
          floor: { id: placementContext.floorId, name: placementContext.floorName },
          section: { id: placementContext.sectionId, name: placementContext.sectionName },
          subsection:
            placementContext.placementLevel === "subsection" && placementContext.subsectionId
              ? {
                  id: placementContext.subsectionId,
                  name: placementContext.subsectionName,
                }
              : null,
          placementLevel: placementContext.placementLevel || "section",
        }
      : await resolvePlacementIds(buildingName, row);
    if (!target) {
      skipped.push(row.deviceAddress);
      continue;
    }

    if (parseNumber(row.x) === null || parseNumber(row.y) === null) {
      skipped.push(row.deviceAddress);
      continue;
    }

    const coords = applyCsvPlacementCoords(row, coordOptions);
    if (!coords || coords.relativeX === null || coords.relativeY === null) {
      skipped.push(row.deviceAddress);
      continue;
    }

    const key = placementTargetKey(target);
    if (!grouped.has(key)) grouped.set(key, { target, items: [] });
    grouped.get(key).items.push({ row, asset });
  }

  let restored = 0;
  let coordinateUpdates = 0;
  const totalGroups = grouped.size;
  let groupIndex = 0;

  for (const { target, items } of grouped.values()) {
    groupIndex += 1;
    onProgress?.({ phase: "mappings", current: groupIndex, total: totalGroups });

    const { floor, section, subsection, placementLevel } = target;
    const existing =
      placementLevel === "subsection"
        ? await FirestoreService.getSubsectionAssetMappings(
            buildingName,
            floor.id,
            section.id,
            subsection.id,
          )
        : await FirestoreService.getSectionAssetMappings(buildingName, floor.id, section.id);

    let nextMappings = [...existing];

    for (const { row, asset } of items) {
      const mapping = buildMappingFromImportRow(row, asset, buildingName, target, coordOptions);
      nextMappings = nextMappings.filter((m) => !pickerAssetMatchesMapping(asset, m));
      nextMappings.push(mapping);
      restored += 1;

      if (await updateAssetCoordinatesFromRow(buildingName, asset, row)) {
        coordinateUpdates += 1;
      }
    }

    if (placementLevel === "subsection") {
      await FirestoreService.updateSubsectionAssetMappings(
        buildingName,
        floor.id,
        section.id,
        subsection.id,
        nextMappings,
      );
    } else {
      await FirestoreService.updateSectionAssetMappings(
        buildingName,
        floor.id,
        section.id,
        nextMappings,
      );
    }
  }

  return {
    restored,
    coordinateUpdates,
    unmatched,
    skipped,
    totalRows: rows.length,
  };
}
