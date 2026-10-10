import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import {
  expandPanelAddressMatchKeys,
  findAssetsListEntryByPanelAddress,
  invalidateAssetsListSnapshotCache,
} from "@/lib/assetsListSimplexStatus";
import { readSimplexStatus } from "@/lib/firePanelMonitor";
import { getTempPanelList, syncPanelListWithTempArray } from "@/lib/firePanelListHistory";
import { saveListToCategoryDb } from "@/lib/recordAlarmHistory";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/**
 * Re-enabling a device (`disable <addr> off`) clears its trouble locally instead
 * of re-running `list t`: T=0 on the device and its row is dropped from
 * trouble-list. The trouble-count drop this causes is "expected" for a while so
 * the follow-up `show counts` does not re-list troubles (see fetchAndSyncCounts).
 */
const EXPECTED_DROP_TTL_MS = 30000;
let expectedTroubleDrops = [];

function pruneExpectedDrops() {
  const now = Date.now();
  expectedTroubleDrops = expectedTroubleDrops.filter((drop) => now - drop.at < EXPECTED_DROP_TTL_MS);
}

/**
 * Register one trouble-count drop caused by re-enabling a device. Returns
 * `withdraw()`: removes it again and returns false when it was already consumed.
 */
export function expectEnabledTroubleDrop() {
  pruneExpectedDrops();
  const drop = { at: Date.now() };
  expectedTroubleDrops.push(drop);
  return () => {
    const index = expectedTroubleDrops.indexOf(drop);
    if (index === -1) return false;
    expectedTroubleDrops.splice(index, 1);
    return true;
  };
}

/**
 * True when a trouble-count drop of `drop` is fully explained by re-enabled
 * devices — those expectations are consumed and no `list t` is needed.
 */
export function consumeEnabledTroubleDrop(drop) {
  pruneExpectedDrops();
  if (drop <= 0 || expectedTroubleDrops.length < drop) return false;
  expectedTroubleDrops.splice(0, drop);
  return true;
}

function rowMatchesAddress(row, addressKeys) {
  for (const value of [row?.fullAddress, row?.deviceAddress]) {
    const text = String(value || "").trim();
    if (!text || text === "NA" || text === "—") continue;
    for (const key of expandPanelAddressMatchKeys(text)) {
      if (addressKeys.has(key)) return true;
    }
  }
  return false;
}

/** Set T=0 on the AssetsList device (DB + live marker store). */
async function clearTroubleFlag(address) {
  useAssetFireStatusStore.getState().optimisticallySetFlagForAddresses([address], "T", 0);

  const entry = await findAssetsListEntryByPanelAddress(address);
  if (!entry) return;
  const ref = doc(db, "AssetsList", entry.id);
  const snap = await getDoc(ref);
  const data = snap.exists() ? snap.data() : entry.data;
  const current = readSimplexStatus(data);
  if (Number(current.T) === 0) return;

  const next = { ...current, T: 0 };
  await updateDoc(ref, { simplexStatus: next, updatedAt: new Date().toISOString() });
  invalidateAssetsListSnapshotCache();
  useAssetFireStatusStore
    .getState()
    .patchSimplexStatusFromEntry(entry.id, data || {}, next, address);
}

/** Drop the device's row(s) from trouble-list (temp cache + DB doc). Returns true if one was removed. */
async function removeTroubleRow(address) {
  const addressKeys = expandPanelAddressMatchKeys(address);
  if (addressKeys.size === 0) return false;

  const tempRows = getTempPanelList("Trouble");
  const keptTempRows = tempRows.filter((row) => !rowMatchesAddress(row, addressKeys));
  if (keptTempRows.length !== tempRows.length) {
    syncPanelListWithTempArray("Trouble", keptTempRows);
  }

  const snap = await getDoc(doc(db, "trouble-list", "current"));
  const rows = snap.exists() && Array.isArray(snap.data()?.rows) ? snap.data().rows : [];
  const keptRows = rows.filter((row) => !rowMatchesAddress(row, addressKeys));
  if (keptRows.length === rows.length) return false;

  await saveListToCategoryDb("Trouble", keptRows);
  return true;
}

/**
 * After a device is re-enabled: T=0 for it and its trouble-list row removed.
 * Returns true when a trouble row was removed (the panel trouble count drops).
 */
export async function clearEnabledDeviceTrouble(deviceAddress) {
  const address = String(deviceAddress || "").trim();
  if (!address) return false;

  const [flagResult, rowResult] = await Promise.allSettled([
    clearTroubleFlag(address),
    removeTroubleRow(address),
  ]);
  if (flagResult.status === "rejected") {
    console.error("[deviceEnabledSync] clearing T failed:", flagResult.reason);
  }
  if (rowResult.status === "rejected") {
    console.error("[deviceEnabledSync] removing trouble row failed:", rowResult.reason);
    return false;
  }
  return rowResult.value;
}
