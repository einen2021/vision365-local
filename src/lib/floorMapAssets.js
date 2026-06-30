import { collection, getDocs } from "firebase/firestore"
import { resolveAssetDeviceAddress } from "./simplexDeviceAddress"

/** Case-insensitive building name comparison for AssetsList `building` field. */
export function buildingsMatch(assetBuilding, selectedBuilding) {
  return (
    String(assetBuilding || "")
      .trim()
      .toLowerCase() ===
    String(selectedBuilding || "")
      .trim()
      .toLowerCase()
  )
}

export function getFloorMapName(assetData) {
  return assetData?.floorMapName || assetData?.floorPlanName || ""
}

export function matchesFloorMap(assetData, floorPlanName) {
  if (!floorPlanName) return false
  return getFloorMapName(assetData) === floorPlanName
}

export function hasFloorPosition(assetData) {
  return typeof assetData?.x === "number" && typeof assetData?.y === "number"
}

export function isPlacedOnFloorMap(assetData, floorPlanName) {
  return matchesFloorMap(assetData, floorPlanName) && hasFloorPosition(assetData)
}

/** Fields written to AssetsList (and building DB) when an asset is placed on a floor map. */
export function buildFloorMapPositionPayload({
  floorPlanName,
  building,
  x,
  y,
  relativeX,
  relativeY,
}) {
  return {
    floorPlanName: floorPlanName || "",
    floorMapName: floorPlanName || "",
    building: building || "",
    x,
    y,
    relativeX: typeof relativeX === "number" ? relativeX : null,
    relativeY: typeof relativeY === "number" ? relativeY : null,
    position: { x, y },
  }
}

/** Clears floor-map placement fields from an AssetsList document. */
export function buildClearFloorMapPositionPayload() {
  return {
    floorPlanName: "",
    floorMapName: "",
    x: null,
    y: null,
    relativeX: null,
    relativeY: null,
    position: null,
  }
}

/** Clears nested floor-plan placement fields (building → floor → section → subsection). */
export function buildClearNestedFloorMapPositionPayload(
  now = new Date().toISOString(),
) {
  return {
    ...buildClearFloorMapPositionPayload(),
    buildingName: "",
    building: "",
    placementLevel: "",
    nestedPath: "",
    floorId: "",
    floorName: "",
    floorImageUrl: "",
    sectionId: "",
    sectionName: "",
    sectionImageUrl: "",
    subsectionId: "",
    subsectionName: "",
    subsectionImageUrl: "",
    floorDetails: null,
    sectionDetails: null,
    subsectionDetails: null,
    updatedAt: now,
  }
}

export function getAssetsListIdFromMapping(mapping) {
  return (
    mapping?.assetsListId ||
    mapping?.details?.assetsListId ||
    mapping?.details?.id ||
    null
  )
}

/** Resolve device fields from a floor-map mapping (flat or nested under details). */
export function resolveMappingDeviceFields(mapping = {}) {
  const details = mapping.details || {}
  const source = {
    deviceAddress: mapping.deviceAddress ?? details.deviceAddress,
    deviceLocation: mapping.deviceLocation ?? details.deviceLocation,
    partNumber: mapping.partNumber ?? details.partNumber,
    loopNumber: mapping.loopNumber ?? details.loopNumber,
    deviceNumber: mapping.deviceNumber ?? details.deviceNumber,
    subAdd: mapping.subAdd ?? details.subAdd,
  }

  return {
    deviceAddress: resolveAssetDeviceAddress(source),
    deviceLocation: String(source.deviceLocation || "").trim(),
  }
}

/**
 * Build an AssetsList update when placing on a floor map.
 * Only includes device fields when non-empty so existing values are not wiped.
 */
export function buildFloorMapAssetsListUpdate({
  floorPlanName,
  building,
  x,
  y,
  relativeX,
  relativeY,
  mapping,
  now = new Date().toISOString(),
}) {
  const payload = {
    ...buildFloorMapPositionPayload({
      floorPlanName,
      building,
      x,
      y,
      relativeX,
      relativeY,
    }),
    updatedAt: now,
  }

  const { deviceAddress, deviceLocation } = resolveMappingDeviceFields(mapping)
  if (deviceAddress) payload.deviceAddress = deviceAddress
  if (deviceLocation) payload.deviceLocation = deviceLocation

  return payload
}

/** AssetsList / building-asset update for nested floor-plan placement. */
export function buildNestedFloorMapAssetsListUpdate({
  mapping,
  now = new Date().toISOString(),
}) {
  const payload = {
    ...buildFloorMapPositionPayload({
      floorPlanName: mapping.floorPlanName || mapping.floorMapName,
      building: mapping.buildingName || mapping.building,
      x: mapping.x,
      y: mapping.y,
      relativeX: mapping.relativeX,
      relativeY: mapping.relativeY,
    }),
    buildingName: mapping.buildingName || mapping.building || "",
    placementLevel: mapping.placementLevel || "",
    nestedPath: mapping.nestedPath || "",
    floorId: mapping.floorId || "",
    floorName: mapping.floorName || "",
    floorImageUrl: mapping.floorImageUrl || "",
    sectionId: mapping.sectionId || "",
    sectionName: mapping.sectionName || "",
    sectionImageUrl: mapping.sectionImageUrl || "",
    subsectionId: mapping.subsectionId || "",
    subsectionName: mapping.subsectionName || "",
    subsectionImageUrl: mapping.subsectionImageUrl || "",
    floorDetails: mapping.floorDetails || null,
    sectionDetails: mapping.sectionDetails || null,
    subsectionDetails: mapping.subsectionDetails || null,
    updatedAt: now,
  }

  const { deviceAddress, deviceLocation } = resolveMappingDeviceFields(mapping)
  if (deviceAddress) payload.deviceAddress = deviceAddress
  if (deviceLocation) payload.deviceLocation = deviceLocation

  return payload
}

/** Device + placement fields to keep on mapping objects through place/save. */
export function pickMappingDeviceFields(asset = {}) {
  const deviceAddress = resolveAssetDeviceAddress(asset)
  return {
    deviceLocation: asset.deviceLocation || "",
    deviceAddress,
    partNumber: asset.partNumber || deviceAddress || "",
    loopNumber: asset.loopNumber ?? "",
    deviceNumber: asset.deviceNumber ?? "",
    subAdd: asset.subAdd ?? 0,
  }
}

/** Case-insensitive match for asset address search in floor-map pickers. */
export function matchesAssetAddressSearch(asset = {}, query = "") {
  const q = String(query || "").trim().toLowerCase()
  if (!q) return true

  const haystack = [
    resolveAssetDeviceAddress(asset),
    asset.deviceAddress,
    asset.partNumber,
    asset.deviceLocation,
    asset.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()

  return haystack.includes(q)
}

/** Primary label for floor-map asset picker rows — prefer panel device address. */
export function getAssetPlacementLabel(asset = {}) {
  const address = resolveAssetDeviceAddress(asset)
  if (address) return address
  return (
    asset.itemType ||
    asset.assetName ||
    asset.name ||
    asset.assetId ||
    asset.id ||
    "Asset"
  )
}

/** Load placed assets for a floor map from the global AssetsList collection. */
export async function loadFloorMapAssetsFromAssetsList(db, buildingName, floorPlanName) {
  const snapshot = await getDocs(collection(db, "AssetsList"))
  const mappings = []

  snapshot.forEach((docSnap) => {
    const data = docSnap.data()
    if (!buildingsMatch(data.building, buildingName)) return
    if (!matchesFloorMap(data, floorPlanName)) return
    if (!hasFloorPosition(data)) return

    const assetName =
      data.itemType || data.assetName || data.assetId || docSnap.id

    mappings.push({
      id: docSnap.id,
      assetsListId: docSnap.id,
      assetName,
      category: data.system || data.category || "uploaded",
      categoryKey: data.categoryKey || data.category || "uploaded",
      x: data.x,
      y: data.y,
      relativeX: data.relativeX,
      relativeY: data.relativeY,
      floorMapName: getFloorMapName(data),
      floorPlanName: getFloorMapName(data),
      building: data.building || buildingName,
      active: data.active || 0,
      customImageUrl: data.customImageUrl || null,
      deviceLocation: data.deviceLocation || "",
      deviceAddress: resolveAssetDeviceAddress(data),
      partNumber: data.partNumber || "",
      installed: data.installed || false,
      activityStatus: data.activityStatus !== undefined ? data.activityStatus : 1,
      enabled: data.enabled !== undefined ? data.enabled : true,
      assetMode: "building",
    })
  })

  return mappings
}

function pickerAssetMatchesMapping(asset = {}, mapping = {}) {
  const mode = asset.assetMode || "general"
  const mappingMode = mapping.assetMode || "general"
  const assetsListId = asset.assetsListId || asset.id

  if (mode === "general") {
    const mappingListId = getAssetsListIdFromMapping(mapping)
    if (assetsListId && mappingListId && assetsListId === mappingListId) return true
  }

  if (mode === "building" && mappingMode === "building") {
    if (
      asset.id &&
      mapping.buildingAssetId &&
      asset.id === mapping.buildingAssetId &&
      asset.category === mapping.category
    ) {
      return true
    }
  }

  return false
}

/** Mapping on the current plan that matches a picker row, if any. */
export function findPickerAssetMapping(asset = {}, placedMappings = []) {
  if (!asset || placedMappings.length === 0) return null
  return placedMappings.find((mapping) => pickerAssetMatchesMapping(asset, mapping)) || null
}

/** True when a picker row already has a marker on the current floor plan. */
export function isPickerAssetAlreadyPlaced(asset = {}, placedMappings = []) {
  return Boolean(findPickerAssetMapping(asset, placedMappings))
}

/** True when AssetsList (or similar) data shows the asset on a nested floor plan. */
export function isAssetPlacedInBuilding(asset = {}) {
  if (!hasFloorPosition(asset)) return false
  return Boolean(
    asset.floorId ||
      asset.floorName ||
      asset.sectionName ||
      asset.subsectionName ||
      asset.nestedPath,
  )
}

/** Human-readable floor → section → subsection label for a placement record. */
export function formatNestedPlacementLabel(record = {}) {
  if (record.nestedPath) {
    return String(record.nestedPath).replace(/ > /g, " → ")
  }

  const parts = []
  if (record.floorName) parts.push(`Floor: ${record.floorName}`)
  if (record.sectionName) parts.push(`Section: ${record.sectionName}`)
  if (record.subsectionName) parts.push(`Subsection: ${record.subsectionName}`)

  if (parts.length > 0) return parts.join(" · ")

  const path = [record.floorName, record.sectionName, record.subsectionName].filter(Boolean)
  return path.join(" → ") || "Unknown location"
}

/** Where a picker asset is placed — current map, saved building placement, or fallback context. */
export function getPickerAssetPlacementLocation(
  asset = {},
  placedMappings = [],
  currentPlacementContext = null,
) {
  const onMap = findPickerAssetMapping(asset, placedMappings)
  if (onMap) {
    return formatNestedPlacementLabel({
      ...currentPlacementContext,
      ...onMap,
    })
  }

  if (isAssetPlacedInBuilding(asset)) {
    return formatNestedPlacementLabel(asset)
  }

  return null
}

/** Picker row is unavailable because it is already placed on this map or elsewhere. */
export function isPickerAssetUnavailable(asset = {}, placedMappings = []) {
  return isPickerAssetAlreadyPlaced(asset, placedMappings) || isAssetPlacedInBuilding(asset)
}

/** True when two floor-map placements refer to the same physical asset. */
export function isDuplicateFloorPlacement(a, b) {
  if (!a || !b) return false
  if (a.assetsListId && b.assetsListId && a.assetsListId === b.assetsListId) return true
  if (a.id && b.id && a.id === b.id) return true
  if (a.id && b.assetsListId && a.id === b.assetsListId) return true
  if (a.assetsListId && b.id && a.assetsListId === b.id) return true

  const samePosition =
    typeof a.x === "number" &&
    typeof b.x === "number" &&
    typeof a.y === "number" &&
    typeof b.y === "number" &&
    a.x === b.x &&
    a.y === b.y
  if (!samePosition) return false

  const addrA = resolveAssetDeviceAddress(a)
  const addrB = resolveAssetDeviceAddress(b)
  if (addrA && addrB) return addrA === addrB
  return true
}

function collectAllPlacements(assetMappings) {
  const all = []
  Object.values(assetMappings || {}).forEach((assetsByName) => {
    Object.values(assetsByName || {}).forEach((locations) => {
      if (Array.isArray(locations)) all.push(...locations)
    })
  })
  return all
}

/** Merge AssetsList placements into nested assetMappings used by the view page. */
export function mergeAssetsListIntoAssetMappings(assetMappings, assetsListMappings) {
  const merged = { ...assetMappings }
  const existingPlacements = collectAllPlacements(merged)

  assetsListMappings.forEach((asset) => {
    if (existingPlacements.some((loc) => isDuplicateFloorPlacement(loc, asset))) {
      return
    }

    const category = asset.category || "uploaded"
    const assetName = asset.assetName

    if (!merged[category]) merged[category] = {}
    if (!merged[category][assetName]) merged[category][assetName] = []

    const alreadyExists = merged[category][assetName].some((loc) =>
      isDuplicateFloorPlacement(loc, asset),
    )
    if (!alreadyExists) {
      merged[category][assetName].push(asset)
      existingPlacements.push(asset)
    }
  })

  return merged
}
