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

/** Merge AssetsList placements into nested assetMappings used by the view page. */
export function mergeAssetsListIntoAssetMappings(assetMappings, assetsListMappings) {
  const merged = { ...assetMappings }

  assetsListMappings.forEach((asset) => {
    const category = asset.category || "uploaded"
    const assetName = asset.assetName

    if (!merged[category]) merged[category] = {}
    if (!merged[category][assetName]) merged[category][assetName] = []

    const alreadyExists = merged[category][assetName].some(
      (loc) => loc.id === asset.id || loc.assetsListId === asset.assetsListId,
    )
    if (!alreadyExists) {
      merged[category][assetName].push(asset)
    }
  })

  return merged
}
