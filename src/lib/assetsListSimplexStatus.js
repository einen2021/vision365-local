import { doc, getDoc, updateDoc } from "firebase/firestore"
import { db } from "@/config/firebase"
import {
  getAssetsListIdFromMapping,
  getAssetsListSnapshot,
  invalidateAssetsListSnapshotCache,
} from "@/lib/floorMapAssets"
import { normalizeSimplexStatus } from "@/lib/assetFireStatus"
import {
  resolveAssetDeviceAddress,
  parseSimplexAddressToken,
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

/** Find AssetsList row by panel list address (doc id or deviceAddress field). */
export async function findAssetsListEntryByPanelAddress(panelAddress) {
  const token = String(panelAddress || "").trim()
  if (!token) return null

  const candidates = new Set([token])
  const parsed = parseSimplexAddressToken(token)
  if (parsed?.full) candidates.add(parsed.full)
  if (parsed?.mAddress) candidates.add(parsed.mAddress)

  // Fast path: AssetsList doc id often matches the panel address.
  for (const id of candidates) {
    const snap = await getDoc(doc(db, "AssetsList", id))
    if (snap.exists()) return { id: snap.id, data: snap.data() }
  }

  // Cached full scan — much faster than getDocs() on every fire address.
  const snapshot = await getAssetsListSnapshot(db)
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data()
    const resolved = resolveAssetDeviceAddress(data)
    if (
      candidates.has(resolved) ||
      candidates.has(String(resolved).toUpperCase()) ||
      candidates.has(docSnap.id)
    ) {
      return { id: docSnap.id, data }
    }

    // Also match stripped panel prefix (2:M1-2-0 vs M1-2-0).
    for (const candidate of candidates) {
      const a = String(resolved || "").toUpperCase()
      const b = String(candidate || "").toUpperCase()
      if (!a || !b) continue
      if (a === b) return { id: docSnap.id, data }
      if (a.replace(/^\d+:/, "") === b.replace(/^\d+:/, "")) {
        return { id: docSnap.id, data }
      }
    }
  }

  return null
}

/** Set simplexStatus.F or .T to 0 on the AssetsList record. */
export async function resetSimplexFlag(asset, deviceAddress, flag) {
  if (flag !== "F" && flag !== "T") {
    throw new Error("Invalid simplex flag")
  }

  const assetsListId = await resolveAssetsListDocId(asset, deviceAddress)
  if (!assetsListId) {
    throw new Error("AssetsList record not found for this asset")
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
    .patchSimplexStatusFromEntry(assetsListId, snap.data() || {}, next)

  return next
}
