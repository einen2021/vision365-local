import { doc, getDoc, updateDoc } from "firebase/firestore"
import { db } from "@/config/firebase"
import {
  getAssetsListIdFromMapping,
  getAssetsListSnapshot,
  invalidateAssetsListSnapshotCache,
} from "@/lib/floorMapAssets"
export { invalidateAssetsListSnapshotCache }
import {
  collectDeviceAddressKeys,
  normalizeSimplexStatus,
} from "@/lib/assetFireStatus"
import {
  resolveAssetDeviceAddress,
  parseSimplexAddressToken,
  stripPanelAddressPrefix,
} from "@/lib/simplexDeviceAddress"
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore"

/** Find the global AssetsList document for a floor-map / building asset. */
export async function resolveAssetsListDocId(asset, deviceAddress = "") {
  const candidates = [
    getAssetsListIdFromMapping(asset),
    asset?.assetsListId,
    asset?.id,
    asset?.buildingAssetId,
  ].filter(Boolean)

  for (const id of candidates) {
    const snap = await getDoc(doc(db, "AssetsList", String(id)))
    if (snap.exists()) return snap.id
  }

  const targetAddress = resolveAssetDeviceAddress({ ...asset, deviceAddress })
  if (!targetAddress) return null

  // Use cached snapshot — avoid re-downloading AssetsList on every lookup.
  const snapshot = await getAssetsListSnapshot(db)
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data()
    if (resolveAssetDeviceAddress(data) === targetAddress) return docSnap.id
  }

  return null
}

/**
 * Build every address form we might need to match panel ↔ AssetsList.
 * Covers: 2:M1-2-0, M1-2-0, M1-2, trailing -0, loop/device fields.
 */
export function expandPanelAddressMatchKeys(panelAddress) {
  const keys = new Set()

  const add = (value) => {
    const raw = String(value || "").trim()
    if (!raw) return
    for (const key of collectDeviceAddressKeys(raw)) {
      keys.add(String(key).toUpperCase())
    }
    const stripped = stripPanelAddressPrefix(raw).toUpperCase()
    if (stripped) keys.add(stripped)
    // Panel often reports M1-2-0 while AssetsList stores M1-2 (or the reverse).
    if (/-\d+$/.test(stripped)) {
      keys.add(stripped.replace(/-\d+$/, ""))
    }
    if (/^M\d+-\d+$/i.test(stripped)) {
      keys.add(`${stripped}-0`)
    }
  }

  add(panelAddress)
  const parsed = parseSimplexAddressToken(panelAddress)
  if (parsed?.full) add(parsed.full)
  if (parsed?.mAddress) add(parsed.mAddress)

  return keys
}

/** All searchable address keys for one AssetsList document. */
export function collectAssetAddressMatchKeys(asset = {}, docId = "") {
  const keys = new Set()
  const add = (value) => {
    for (const key of expandPanelAddressMatchKeys(value)) {
      keys.add(key)
    }
  }

  add(docId)
  add(asset.id)
  add(asset.deviceAddress)
  add(asset.partNumber)
  add(asset.address)
  add(asset.simplexAddress)
  add(resolveAssetDeviceAddress(asset))

  // Build from loop / device / subAdd when stored as separate fields.
  if (asset.loopNumber && asset.deviceNumber) {
    add(
      resolveAssetDeviceAddress({
        loopNumber: asset.loopNumber,
        deviceNumber: asset.deviceNumber,
        subAdd: asset.subAdd,
        panel: asset.panel ?? asset.Panel ?? null,
        includeZeroSubAdd: true,
      }),
    )
    add(
      resolveAssetDeviceAddress({
        loopNumber: asset.loopNumber,
        deviceNumber: asset.deviceNumber,
        subAdd: asset.subAdd,
        panel: asset.panel ?? asset.Panel ?? null,
        includeZeroSubAdd: false,
      }),
    )
  }

  return keys
}

// In-memory address → AssetsList row map, rebuilt when the snapshot changes.
let addressIndexRef = null

/** Clear the address index (call when AssetsList snapshot cache is invalidated). */
export function clearAssetsListAddressIndex() {
  addressIndexRef = null
}

/**
 * Build (or reuse) a Map of every address key → AssetsList entry.
 * One pass over AssetsList is much faster than scanning per fire address.
 */
async function getAssetsListAddressIndex() {
  const snapshot = await getAssetsListSnapshot(db)
  if (addressIndexRef?.snapshot === snapshot) {
    return addressIndexRef.map
  }

  const map = new Map()
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data()
    const entry = { id: docSnap.id, data }
    for (const key of collectAssetAddressMatchKeys(data, docSnap.id)) {
      // Keep the first match for each key (stable / predictable).
      if (!map.has(key)) map.set(key, entry)
    }
  }

  addressIndexRef = { snapshot, map }
  return map
}

/** Find AssetsList row by panel list address (doc id or deviceAddress field). */
export async function findAssetsListEntryByPanelAddress(panelAddress) {
  const token = String(panelAddress || "").trim()
  if (!token) return null

  const panelKeys = expandPanelAddressMatchKeys(token)

  // If the address index is already warm, use it first (no network).
  if (addressIndexRef?.map) {
    for (const panelKey of panelKeys) {
      const hit = addressIndexRef.map.get(panelKey)
      if (hit) return hit
    }
  }

  // Fast path: only a few likely doc ids (avoid dozens of getDoc round-trips).
  const likelyIds = []
  const addLikely = (value) => {
    const id = String(value || "").trim()
    if (!id) return
    if (!likelyIds.some((existing) => existing.toUpperCase() === id.toUpperCase())) {
      likelyIds.push(id)
    }
  }
  addLikely(token)
  const parsed = parseSimplexAddressToken(token)
  if (parsed?.full) addLikely(parsed.full)
  if (parsed?.mAddress) addLikely(parsed.mAddress)

  for (const id of likelyIds) {
    const snap = await getDoc(doc(db, "AssetsList", id))
    if (snap.exists()) return { id: snap.id, data: snap.data() }
  }

  // Indexed lookup from cached AssetsList snapshot (O(keys), not O(docs)).
  const index = await getAssetsListAddressIndex()
  for (const panelKey of panelKeys) {
    const hit = index.get(panelKey)
    if (hit) return hit
  }

  return null
}

/**
 * Resolve AssetsList entries for every address in a panel list response.
 * Newest / last address is preferred first (fire alert uses the latest device).
 */
export async function findAssetsForPanelAddresses(panelAddresses = []) {
  const unique = []
  const seen = new Set()
  for (const address of panelAddresses || []) {
    const key = String(address || "").trim().toUpperCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    unique.push(String(address).trim())
  }

  // Pre-build the address index once so each lookup can hit memory first.
  if (unique.length > 0) {
    await getAssetsListAddressIndex()
  }

  const results = []
  // Walk newest-last first so fire alert gets the latest device ASAP.
  for (let i = unique.length - 1; i >= 0; i -= 1) {
    const deviceAddress = unique[i]
    const entry = await findAssetsListEntryByPanelAddress(deviceAddress)
    results.push({
      deviceAddress,
      entry,
      found: Boolean(entry),
    })
  }
  return results
}

/** Uppercase, whitespace-collapsed comparison key for panel location text. */
function normalizeLocationText(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
}

/**
 * Find the AssetsList doc whose deviceLocation / deviceDescription matches a
 * fire-panel-printed location string (e.g. "SUB BS CORRIDOR COS 21 SB/L1/2").
 * Returns { id, data } or null.
 */
export async function findAssetsListDocByLocationText(locationText) {
  const target = normalizeLocationText(locationText)
  if (!target) return null

  const snapshot = await getAssetsListSnapshot(db)
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data()
    const candidates = [data.deviceLocation, data.deviceDescription, data.description]
    const matched = candidates.some((candidate) => normalizeLocationText(candidate) === target)
    if (matched) return { id: docSnap.id, data }
  }

  return null
}

/**
 * Match a fire-panel-printed location string against AssetsList and return the
 * matched asset's device address, or "" when nothing matches.
 */
export async function findDeviceAddressByLocationText(locationText) {
  const match = await findAssetsListDocByLocationText(locationText)
  if (!match) return ""
  return resolveAssetDeviceAddress(match.data) || match.data.deviceAddress || match.id || ""
}

/** Set simplexStatus.F, .T, or .S to 0 on the AssetsList record. */
export async function resetSimplexFlag(asset, deviceAddress, flag) {
  if (flag !== "F" && flag !== "T" && flag !== "S") {
    throw new Error("Invalid simplex flag")
  }

  const assetsListId = await resolveAssetsListDocId(asset, deviceAddress)
  if (!assetsListId) {
    const assetId = asset?.buildingAssetId || asset?.id || ""
    const current = useAssetFireStatusStore.getState().getSimplexStatus(assetId, deviceAddress) || { F: 0, T: 0, S: 0 }
    const next = { ...current, [flag]: 0 }
    useAssetFireStatusStore.getState().patchSimplexStatus(assetId, deviceAddress, next)
    return next
  }

  const assetRef = doc(db, "AssetsList", assetsListId)
  const snap = await getDoc(assetRef)
  const current = normalizeSimplexStatus(snap.data()?.simplexStatus)
  const next = { ...current, [flag]: 0 }

  await updateDoc(assetRef, {
    simplexStatus: next,
    updatedAt: new Date().toISOString(),
  })

  invalidateAssetsListSnapshotCache()
  useAssetFireStatusStore
    .getState()
    .patchSimplexStatusFromEntry(assetsListId, snap.data() || {}, next, deviceAddress)

  return next
}
