import { doc, writeBatch } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  collectAssetAddressMatchKeys,
  expandPanelAddressMatchKeys,
  findAssetsListEntriesByPanelAddresses,
} from "@/lib/assetsListSimplexStatus";
import { getAssetsListSnapshot, invalidateAssetsListSnapshotCache } from "@/lib/floorMapAssets";
import { readSimplexStatus, simplexKeyForCategoryLabel } from "@/lib/firePanelMonitor";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

// Per-category temp array of addresses seen in the last list response — diffed
// against the next response so only devices that actually changed (added or
// removed) touch Firestore, instead of scanning the whole AssetsList collection.
// `null` means "no previous run yet for this category" (first run this session).
const previousAddressesByLabel = {
  Fire: null,
  Trouble: null,
  Supervisory: null,
};

/** Clear the temp address array (call alongside a full simplexStatus reset). */
export function clearPanelListAssetSyncTempArray(label) {
  if (label && Object.prototype.hasOwnProperty.call(previousAddressesByLabel, label)) {
    previousAddressesByLabel[label] = null;
  } else {
    previousAddressesByLabel.Fire = null;
    previousAddressesByLabel.Trouble = null;
    previousAddressesByLabel.Supervisory = null;
  }
}

function buildAddressKeySet(addresses = []) {
  const keys = new Set();
  for (const address of addresses) {
    for (const key of expandPanelAddressMatchKeys(address)) {
      keys.add(key);
    }
  }
  return keys;
}

function patchStoreFromEntry(entryId, data, status, extraAddress = "") {
  useAssetFireStatusStore
    .getState()
    .patchSimplexStatusFromEntry(entryId, data, status, extraAddress);
}

/**
 * Sync AssetsList F/T/S flags with the latest panel list output.
 * Diffs the new address list against the temp array from the previous list
 * run for this category: newly-added addresses get the flag set to 1, and
 * addresses that dropped out get the flag reset to 0.
 */
export async function syncAssetsListWithPanelList(label, deviceAddresses = []) {
  invalidateAssetsListSnapshotCache();

  const statusKey = simplexKeyForCategoryLabel(label);
  const now = new Date().toISOString();
  let updatedCount = 0;
  let clearedCount = 0;

  // 1. Instantly update in-memory store in 0ms
  useAssetFireStatusStore
    .getState()
    .syncPanelLiveFlagsForCategory(statusKey, deviceAddresses);

  // 2. Diff against the temp array of addresses from the previous run
  const previousAddresses = previousAddressesByLabel[label];
  let addedAddresses = deviceAddresses;
  let removedAddresses = [];

  if (previousAddresses !== null) {
    const previousKeys = buildAddressKeySet(previousAddresses);
    const currentKeys = buildAddressKeySet(deviceAddresses);

    addedAddresses = deviceAddresses.filter((address) =>
      [...expandPanelAddressMatchKeys(address)].every((key) => !previousKeys.has(key)),
    );
    removedAddresses = previousAddresses.filter((address) =>
      [...expandPanelAddressMatchKeys(address)].every((key) => !currentKeys.has(key)),
    );
  }
  // else: first run this session for this category — treat every address as
  // newly added. There is no previous list to diff, so clear any flag still set
  // in AssetsList for a device the panel no longer reports (cached snapshot —
  // the same one the address index below is built from).
  const staleEntries = [];
  if (previousAddresses === null) {
    const currentKeys = buildAddressKeySet(deviceAddresses);
    const snapshot = await getAssetsListSnapshot(db);
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      if (Number(readSimplexStatus(data)[statusKey]) !== 1) continue;
      const keys = collectAssetAddressMatchKeys(data, docSnap.id);
      if ([...keys].some((key) => currentKeys.has(key))) continue;
      staleEntries.push({ id: docSnap.id, data });
    }
  }

  // 3. Resolve every changed address in one index pass, then write all flag
  //    changes as a single batch (one DB write + one revision bump).
  const entries = await findAssetsListEntriesByPanelAddresses([
    ...addedAddresses,
    ...removedAddresses,
  ]);
  const batch = writeBatch(db);
  let batchSize = 0;

  for (const deviceAddress of addedAddresses) {
    const entry = entries.get(String(deviceAddress).trim());
    if (!entry) continue;

    const data = { ...entry.data, id: entry.id };
    const current = readSimplexStatus(data);
    if (Number(current[statusKey]) === 1) {
      patchStoreFromEntry(entry.id, data, current, deviceAddress);
      continue;
    }

    const next = { ...current, [statusKey]: 1 };
    patchStoreFromEntry(entry.id, data, next, deviceAddress);
    batch.update(doc(db, "AssetsList", entry.id), { simplexStatus: next, updatedAt: now });
    batchSize += 1;
    updatedCount += 1;
  }

  for (const deviceAddress of removedAddresses) {
    const entry = entries.get(String(deviceAddress).trim());
    if (!entry) continue;

    const data = { ...entry.data, id: entry.id };
    const current = readSimplexStatus(data);
    if (Number(current[statusKey]) !== 1) continue;

    const next = { ...current, [statusKey]: 0 };
    patchStoreFromEntry(entry.id, data, next, deviceAddress);
    batch.update(doc(db, "AssetsList", entry.id), { simplexStatus: next, updatedAt: now });
    batchSize += 1;
    clearedCount += 1;
  }

  for (const entry of staleEntries) {
    const data = { ...entry.data, id: entry.id };
    const next = { ...readSimplexStatus(data), [statusKey]: 0 };
    patchStoreFromEntry(entry.id, data, next);
    batch.update(doc(db, "AssetsList", entry.id), { simplexStatus: next, updatedAt: now });
    batchSize += 1;
    clearedCount += 1;
  }

  if (batchSize > 0) {
    await batch.commit();
  }

  // 4. Save this run's addresses as the temp array for next comparison
  previousAddressesByLabel[label] = deviceAddresses.slice();

  return { updatedCount, clearedCount, statusKey };
}
