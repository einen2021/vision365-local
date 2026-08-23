import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { findAssetsListEntryByPanelAddress } from "@/lib/assetsListSimplexStatus";
import {
  collectDeviceAddressKeys,
} from "@/lib/assetFireStatus";
import { invalidateAssetsListSnapshotCache } from "@/lib/floorMapAssets";
import { readSimplexStatus, simplexKeyForCategoryLabel } from "@/lib/firePanelMonitor";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

function buildActiveAddressKeys(deviceAddresses = []) {
  const activeKeys = new Set();

  for (const address of deviceAddresses) {
    for (const key of collectDeviceAddressKeys(address)) {
      activeKeys.add(key);
    }
    const raw = String(address || "").trim().toUpperCase();
    if (raw) activeKeys.add(raw);
  }

  return activeKeys;
}

function assetMatchesActiveList(data, activeKeys) {
  const resolved = resolveAssetDeviceAddress(data) || data.deviceAddress || "";
  for (const key of collectDeviceAddressKeys(resolved)) {
    if (activeKeys.has(key)) return true;
  }

  const docId = String(data?.id || "").trim().toUpperCase();
  if (docId && activeKeys.has(docId)) return true;

  return false;
}

function patchStoreFromEntry(entryId, data, status, extraAddress = "") {
  useAssetFireStatusStore
    .getState()
    .patchSimplexStatusFromEntry(entryId, data, status, extraAddress);
}

/**
 * Sync AssetsList F/T/S flags with the latest panel list output.
 * Sets the category flag on active devices and clears it on stale ones.
 */
export async function syncAssetsListWithPanelList(label, deviceAddresses = []) {
  invalidateAssetsListSnapshotCache();

  const statusKey = simplexKeyForCategoryLabel(label);
  const activeKeys = buildActiveAddressKeys(deviceAddresses);
  const now = new Date().toISOString();
  let updatedCount = 0;
  let clearedCount = 0;

  // 1. Instantly update in-memory store in 0ms
  useAssetFireStatusStore
    .getState()
    .syncPanelLiveFlagsForCategory(statusKey, deviceAddresses);

  // 2. Resolve entries and prepare parallel Firestore writes
  const updatePromises = [];
  const matchedDocIds = new Set();

  for (const deviceAddress of deviceAddresses) {
    const entry = await findAssetsListEntryByPanelAddress(deviceAddress);
    if (!entry) continue;

    matchedDocIds.add(entry.id);
    const data = { ...entry.data, id: entry.id };
    const current = readSimplexStatus(data);
    if (Number(current[statusKey]) === 1) {
      patchStoreFromEntry(entry.id, data, current, deviceAddress);
      continue;
    }

    const next = { ...current, [statusKey]: 1 };
    patchStoreFromEntry(entry.id, data, next, deviceAddress);
    updatePromises.push(
      updateDoc(doc(db, "AssetsList", entry.id), {
        simplexStatus: next,
        updatedAt: now,
      }),
    );
    updatedCount += 1;
  }

  // 3. Clear stale assets in AssetsList
  const snapshot = await getDocs(collection(db, "AssetsList"));
  for (const docSnap of snapshot.docs) {
    if (matchedDocIds.has(docSnap.id)) continue;
    const data = { ...docSnap.data(), id: docSnap.id };
    const current = readSimplexStatus(data);
    if (Number(current[statusKey]) !== 1) continue;
    if (assetMatchesActiveList(data, activeKeys)) continue;

    const next = { ...current, [statusKey]: 0 };
    patchStoreFromEntry(docSnap.id, data, next);
    updatePromises.push(
      updateDoc(doc(db, "AssetsList", docSnap.id), {
        simplexStatus: next,
        updatedAt: now,
      }),
    );
    clearedCount += 1;
  }

  // 4. Concurrently execute all writes
  if (updatePromises.length > 0) {
    await Promise.all(updatePromises);
  }

  return { updatedCount, clearedCount, statusKey };
}
