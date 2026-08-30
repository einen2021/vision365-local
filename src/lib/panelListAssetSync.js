import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  expandPanelAddressMatchKeys,
  findAssetsListEntryByPanelAddress,
} from "@/lib/assetsListSimplexStatus";
import { invalidateAssetsListSnapshotCache } from "@/lib/floorMapAssets";
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
  // newly added, nothing to remove (a full reset already zeroed everything).

  const updatePromises = [];

  for (const deviceAddress of addedAddresses) {
    const entry = await findAssetsListEntryByPanelAddress(deviceAddress);
    if (!entry) continue;

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

  for (const deviceAddress of removedAddresses) {
    const entry = await findAssetsListEntryByPanelAddress(deviceAddress);
    if (!entry) continue;

    const data = { ...entry.data, id: entry.id };
    const current = readSimplexStatus(data);
    if (Number(current[statusKey]) !== 1) continue;

    const next = { ...current, [statusKey]: 0 };
    patchStoreFromEntry(entry.id, data, next, deviceAddress);
    updatePromises.push(
      updateDoc(doc(db, "AssetsList", entry.id), {
        simplexStatus: next,
        updatedAt: now,
      }),
    );
    clearedCount += 1;
  }

  // 3. Concurrently execute all writes
  if (updatePromises.length > 0) {
    await Promise.all(updatePromises);
  }

  // 4. Save this run's addresses as the temp array for next comparison
  previousAddressesByLabel[label] = deviceAddresses.slice();

  return { updatedCount, clearedCount, statusKey };
}
