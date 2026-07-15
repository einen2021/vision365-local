import { collection, getDocs } from "firebase/firestore"
import { collectDeviceAddressKeys } from "./assetFireStatus"
import { resolveAssetDeviceAddress } from "./simplexDeviceAddress"

const ASSETS_LIST_CACHE_MS = 60_000
let assetsListSnapshotCache = null
let assetsListSnapshotFetchedAt = 0
let assetsListSnapshotPromise = null

/** Shared AssetsList snapshot cache (used by placement + fire-alert lookups). */
export async function getAssetsListSnapshot(db) {
  const now = Date.now()
  if (
    assetsListSnapshotCache &&
    now - assetsListSnapshotFetchedAt < ASSETS_LIST_CACHE_MS
  ) {
    return assetsListSnapshotCache
  }

  if (!assetsListSnapshotPromise) {
    assetsListSnapshotPromise = getDocs(collection(db, "AssetsList"))
      .then((snapshot) => {
        assetsListSnapshotCache = snapshot
        assetsListSnapshotFetchedAt = Date.now()
        assetsListSnapshotPromise = null
        return snapshot
      })
      .catch((error) => {
        assetsListSnapshotPromise = null
        throw error
      })
  }

  return assetsListSnapshotPromise
}

export function invalidateAssetsListSnapshotCache() {
  assetsListSnapshotCache = null
  assetsListSnapshotFetchedAt = 0
  assetsListSnapshotPromise = null
  // Lazy import avoids a circular dependency with assetsListSimplexStatus.
  void import("@/lib/assetsListSimplexStatus")
    .then((mod) => mod.clearAssetsListAddressIndex?.())
    .catch(() => {})
}

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
  if (typeof assetData?.x === "number" && typeof assetData?.y === "number") return true
  if (typeof assetData?.relativeX === "number" && typeof assetData?.relativeY === "number") {
    return true
  }
  return false
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

/** Clears nested placement plus 3D coordinates from a building / AssetsList asset. */
export function buildClearAssetPlacementPayload(now = new Date().toISOString()) {
  return {
    ...buildClearNestedFloorMapPositionPayload(now),
    coordinates: null,
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
  const snapshot = await getAssetsListSnapshot(db)
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

function buildNestedAssetMappingFromDoc(docSnap, buildingName, {
  floorId,
  sectionId,
  subsectionId = null,
  placementLevel = "section",
}) {
  const data = docSnap.data()
  if (!buildingsMatch(data.building, buildingName)) return null
  if (String(data.floorId || "") !== String(floorId || "")) return null
  if (String(data.sectionId || "") !== String(sectionId || "")) return null

  const assetPlacementLevel =
    data.placementLevel || (data.subsectionId ? "subsection" : "section")

  if (placementLevel === "subsection") {
    if (String(data.subsectionId || "") !== String(subsectionId || "")) return null
    if (assetPlacementLevel !== "subsection") return null
  } else if (assetPlacementLevel === "subsection" && data.subsectionId) {
    return null
  }

  if (!hasFloorPosition(data)) return null

  const assetName =
    data.itemType || data.assetName || data.assetId || docSnap.id

  return {
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
    floorId: data.floorId || floorId,
    sectionId: data.sectionId || sectionId,
    subsectionId: data.subsectionId || "",
    placementLevel: assetPlacementLevel,
    active: data.active || 0,
    customImageUrl: data.customImageUrl || null,
    deviceLocation: data.deviceLocation || "",
    deviceAddress: resolveAssetDeviceAddress(data),
    partNumber: data.partNumber || "",
    installed: data.installed || false,
    activityStatus: data.activityStatus !== undefined ? data.activityStatus : 1,
    enabled: data.enabled !== undefined ? data.enabled : true,
    assetMode: "general",
  }
}

/** AssetsList rows for a nested section or subsection plan (fills gaps in assetMappings). */
export async function loadNestedAssetMappingsFromAssetsList(
  db,
  buildingName,
  { floorId, sectionId, subsectionId = null, placementLevel = "section" },
) {
  const snapshot = await getAssetsListSnapshot(db)
  const mappings = []

  snapshot.forEach((docSnap) => {
    const mapping = buildNestedAssetMappingFromDoc(docSnap, buildingName, {
      floorId,
      sectionId,
      subsectionId,
      placementLevel,
    })
    if (mapping) mappings.push(mapping)
  })

  return mappings
}

/** Merge mapping docs with AssetsList placements, skipping duplicates. */
export function mergeNestedAssetMappings(primary = [], extras = []) {
  const merged = [...primary]
  extras.forEach((asset) => {
    const existingIndex = merged.findIndex((mapping) =>
      pickerAssetMatchesMapping(asset, mapping),
    )
    if (existingIndex >= 0) {
      // Keep the placed marker, but copy device address from AssetsList when missing.
      const existing = merged[existingIndex]
      merged[existingIndex] = {
        ...existing,
        assetsListId:
          existing.assetsListId || asset.assetsListId || asset.id || existing.id,
        deviceAddress:
          existing.deviceAddress ||
          asset.deviceAddress ||
          resolveAssetDeviceAddress(asset) ||
          "",
        deviceLocation: existing.deviceLocation || asset.deviceLocation || "",
        partNumber: existing.partNumber || asset.partNumber || "",
        loopNumber: existing.loopNumber ?? asset.loopNumber,
        deviceNumber: existing.deviceNumber ?? asset.deviceNumber,
        subAdd: existing.subAdd ?? asset.subAdd,
      }
      return
    }
    merged.push(asset)
  })
  return merged
}

/**
 * Fill missing deviceAddress / assetsListId on floor markers from AssetsList.
 * Without this, live F/T colors cannot match markers that only have a placement doc id.
 */
export async function enrichAssetMappingsFromAssetsList(db, mappings = []) {
  const list = Array.isArray(mappings) ? mappings : []
  if (!list.length || !db) return list

  try {
    const snapshot = await getAssetsListSnapshot(db)
    const byId = new Map()
    const rows = []
    snapshot.forEach((docSnap) => {
      const row = { id: docSnap.id, ...docSnap.data() }
      byId.set(docSnap.id, row)
      rows.push(row)
    })

    return list.map((mapping) => {
      const currentAddress = resolveMappingDeviceFields(mapping).deviceAddress
      const candidateIds = [
        getAssetsListIdFromMapping(mapping),
        mapping.buildingAssetId,
        mapping.id,
        mapping.assetId,
      ]
        .map((value) => String(value || "").trim())
        .filter(Boolean)

      let fromList = null
      for (const id of candidateIds) {
        if (byId.has(id)) {
          fromList = byId.get(id)
          break
        }
      }

      if (!fromList) {
        fromList =
          rows.find(
            (row) =>
              pickerAssetMatchesMapping(
                { id: row.id, assetsListId: row.id, assetMode: "general" },
                mapping,
              ) ||
              pickerAssetMatchesMapping(
                { id: row.id, assetsListId: row.id, assetMode: "building" },
                mapping,
              ),
          ) || null
      }

      // Last resort: same coordinates on this plan.
      if (!fromList && typeof mapping.x === "number" && typeof mapping.y === "number") {
        fromList =
          rows.find(
            (row) =>
              typeof row.x === "number" &&
              typeof row.y === "number" &&
              row.x === mapping.x &&
              row.y === mapping.y,
          ) || null
      }
      if (
        !fromList &&
        typeof mapping.relativeX === "number" &&
        typeof mapping.relativeY === "number"
      ) {
        fromList =
          rows.find(
            (row) =>
              typeof row.relativeX === "number" &&
              typeof row.relativeY === "number" &&
              row.relativeX === mapping.relativeX &&
              row.relativeY === mapping.relativeY,
          ) || null
      }

      if (!fromList) return mapping

      const listAddress =
        resolveAssetDeviceAddress(fromList) || fromList.deviceAddress || ""

      return {
        ...mapping,
        assetsListId: mapping.assetsListId || fromList.id,
        deviceAddress: currentAddress || listAddress,
        partNumber: mapping.partNumber || fromList.partNumber || "",
        loopNumber: mapping.loopNumber ?? fromList.loopNumber,
        deviceNumber: mapping.deviceNumber ?? fromList.deviceNumber,
        subAdd: mapping.subAdd ?? fromList.subAdd,
        buildingAssetId: mapping.buildingAssetId || fromList.buildingAssetId,
        // Keep a copy under details too — some placements only read nested fields.
        details: {
          ...(mapping.details || {}),
          deviceAddress:
            currentAddress ||
            listAddress ||
            mapping.details?.deviceAddress ||
            "",
          partNumber:
            mapping.partNumber ||
            fromList.partNumber ||
            mapping.details?.partNumber ||
            "",
        },
      }
    })
  } catch (error) {
    console.warn("[enrichAssetMappingsFromAssetsList] failed:", error)
    return list
  }
}

export function pickerAssetMatchesMapping(asset = {}, mapping = {}) {
  const mode = asset.assetMode || "general"
  const mappingMode = mapping.assetMode || "general"
  const assetsListId = asset.assetsListId || asset.id

  if (mode === "general") {
    const mappingListId = getAssetsListIdFromMapping(mapping)
    if (assetsListId && mappingListId && assetsListId === mappingListId) return true
  }

  if (mode === "building" || mappingMode === "building" || mapping.buildingAssetId) {
    const buildingId = mapping.buildingAssetId || mapping.id
    if (
      asset.id &&
      buildingId &&
      asset.id === buildingId &&
      (!asset.category || !mapping.category || asset.category === mapping.category)
    ) {
      return true
    }
  }

  return false
}

/**
 * Collect every id/address we might see in a deep-link URL or on a marker,
 * so search highlight can match even when id fields differ.
 */
export function collectAssetHighlightKeys(mapping = {}, extraId = "") {
  const keys = new Set()
  const add = (value) => {
    const raw = String(value || "").trim()
    if (!raw) return
    keys.add(raw)
    keys.add(raw.toUpperCase())
  }

  add(extraId)
  add(mapping.id)
  add(mapping.buildingAssetId)
  add(mapping.assetsListId)
  add(mapping.sanitizedId)
  add(mapping.assetId)
  add(getAssetsListIdFromMapping(mapping))

  const { deviceAddress } = resolveMappingDeviceFields(mapping)
  const address = deviceAddress || resolveAssetDeviceAddress(mapping)
  add(address)
  if (address) {
    // Also match without a leading panel prefix like "2:M1-2-1".
    add(address.replace(/^\d+:/i, ""))
  }

  return [...keys]
}

/** True when a floor-map marker matches the current search highlight keys. */
export function mappingMatchesHighlightKeys(mapping = {}, highlightKeys = []) {
  if (!highlightKeys?.length) return false
  const keySet = new Set(
    highlightKeys.map((key) => String(key || "").trim()).filter(Boolean),
  )
  if (!keySet.size) return false
  return collectAssetHighlightKeys(mapping).some((key) => keySet.has(key))
}

/** Resolve the best device address string from a floor-map mapping. */
function resolveMappingAddress(mapping = {}) {
  const { deviceAddress } = resolveMappingDeviceFields(mapping)
  return deviceAddress || resolveAssetDeviceAddress(mapping) || ""
}

/** True when two Simplex-style addresses refer to the same device. */
function addressesLikelyMatch(left = "", right = "") {
  const a = String(left || "").trim()
  const b = String(right || "").trim()
  if (!a || !b) return false

  const leftKeys = collectDeviceAddressKeys(a)
  const rightKeys = collectDeviceAddressKeys(b)
  for (const key of leftKeys) {
    if (rightKeys.has(key)) return true
  }

  // Partial match (same idea as the asset search bar).
  const aUp = a.toUpperCase()
  const bUp = b.toUpperCase()
  if (aUp.includes(bUp) || bUp.includes(aUp)) return true

  const strip = (value) => value.replace(/^\d+:/i, "").toUpperCase()
  const aStrip = strip(aUp)
  const bStrip = strip(bUp)
  if (!aStrip || !bStrip) return false
  return aStrip.includes(bStrip) || bStrip.includes(aStrip)
}

/**
 * Find the placed mapping that matches a deep-link asset id and/or device address.
 * Address matching is important because AssetsList doc ids often differ from
 * floor-plan mapping doc ids.
 */
export function findHighlightMapping(
  mappings = [],
  { assetId = "", address = "" } = {},
) {
  const list = Array.isArray(mappings) ? mappings : []
  if (!list.length) return null

  const targetId = String(assetId || "").trim()
  const targetAddress = String(address || "").trim()

  // Prefer device address — this is what the user searched for.
  if (targetAddress) {
    const byAddress = list.find((mapping) =>
      addressesLikelyMatch(resolveMappingAddress(mapping), targetAddress),
    )
    if (byAddress) return byAddress

    const addressKeys = collectAssetHighlightKeys({}, targetAddress)
    const byAddressKeys = list.find((mapping) =>
      mappingMatchesHighlightKeys(mapping, addressKeys),
    )
    if (byAddressKeys) return byAddressKeys
  }

  if (targetId) {
    const byId = list.find((mapping) =>
      mappingMatchesHighlightKeys(
        mapping,
        collectAssetHighlightKeys({}, targetId),
      ),
    )
    if (byId) return byId

    // Same helper used when placing/picking assets (covers buildingAssetId).
    const byPicker = list.find((mapping) =>
      pickerAssetMatchesMapping(
        { id: targetId, assetsListId: targetId, assetMode: "general" },
        mapping,
      ) ||
      pickerAssetMatchesMapping(
        { id: targetId, assetsListId: targetId, assetMode: "building" },
        mapping,
      ),
    )
    if (byPicker) return byPicker
  }

  // Single placed marker on this plan + we know what was searched → highlight it.
  if (targetAddress || targetId) {
    const placed = list.filter(
      (mapping) =>
        (typeof mapping.relativeX === "number" &&
          typeof mapping.relativeY === "number") ||
        (typeof mapping.x === "number" && typeof mapping.y === "number"),
    )
    if (placed.length === 1) return placed[0]
  }

  return null
}

/**
 * Like findHighlightMapping, but fills missing mapping.deviceAddress from AssetsList
 * first so address match works for legacy placement docs.
 */
export async function findHighlightMappingAsync(
  db,
  mappings = [],
  { assetId = "", address = "" } = {},
) {
  const direct = findHighlightMapping(mappings, { assetId, address })
  if (direct) return direct

  const targetAddress = String(address || "").trim()
  const targetId = String(assetId || "").trim()
  if (!db || (!targetAddress && !targetId)) return null

  try {
    const snapshot = await getAssetsListSnapshot(db)
    const assetsById = new Map()
    snapshot.forEach((docSnap) => {
      assetsById.set(docSnap.id, { id: docSnap.id, ...docSnap.data() })
    })

    // Enrich markers with AssetsList deviceAddress, then rematch.
    const enriched = mappings.map((mapping) => {
      const listId =
        getAssetsListIdFromMapping(mapping) ||
        mapping.buildingAssetId ||
        mapping.id
      const fromList = listId ? assetsById.get(String(listId)) : null
      if (!fromList) return mapping
      return {
        ...mapping,
        assetsListId: mapping.assetsListId || fromList.id,
        deviceAddress:
          resolveMappingAddress(mapping) ||
          resolveAssetDeviceAddress(fromList) ||
          fromList.deviceAddress ||
          "",
        partNumber: mapping.partNumber || fromList.partNumber || "",
        loopNumber: mapping.loopNumber ?? fromList.loopNumber,
        deviceNumber: mapping.deviceNumber ?? fromList.deviceNumber,
        subAdd: mapping.subAdd ?? fromList.subAdd,
      }
    })

    const afterEnrich = findHighlightMapping(enriched, { assetId, address })
    if (afterEnrich) return afterEnrich

    // Last resort: find AssetsList row by address, then match that row to a marker.
    let assetRef = targetId ? assetsById.get(targetId) : null
    if (!assetRef && targetAddress) {
      for (const asset of assetsById.values()) {
        if (
          addressesLikelyMatch(
            resolveAssetDeviceAddress(asset) || asset.deviceAddress || "",
            targetAddress,
          )
        ) {
          assetRef = asset
          break
        }
      }
    }
    if (!assetRef) return null

    return (
      enriched.find(
        (mapping) =>
          pickerAssetMatchesMapping(
            {
              id: assetRef.id,
              assetsListId: assetRef.id,
              assetMode: "general",
            },
            mapping,
          ) ||
          pickerAssetMatchesMapping(
            {
              id: assetRef.id,
              assetsListId: assetRef.id,
              assetMode: "building",
            },
            mapping,
          ) ||
          addressesLikelyMatch(
            resolveMappingAddress(mapping),
            resolveAssetDeviceAddress(assetRef) || targetAddress,
          ),
      ) || null
    )
  } catch (error) {
    console.error("[findHighlightMappingAsync] failed:", error)
    return null
  }
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
