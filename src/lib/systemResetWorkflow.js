import { doc, writeBatch } from "firebase/firestore";
import { waitForAutoPilotListHold } from "@/stores/autoPilotStore";
import { db } from "@/config/firebase";
import { apiUrl } from "@/lib/apiClient";
import { clearAssetsListAddressIndex } from "@/lib/assetsListSimplexStatus";
import { getAssetsListSnapshot, invalidateAssetsListSnapshotCache } from "@/lib/floorMapAssets";
import {
  clearTempPanelList,
  extractPanelDeviceAddresses,
  getListCmdForLabel,
  parsePanelListResponse,
  readSimplexStatus,
  syncPanelListWithTempArray,
} from "@/lib/firePanelMonitor";
import { parseShowCountsResponse } from "@/lib/panelState";
import {
  clearPanelListAssetSyncTempArray,
  syncAssetsListWithPanelList,
} from "@/lib/panelListAssetSync";
import { saveListToCategoryDb } from "@/lib/recordAlarmHistory";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

const CATEGORY_LABELS = ["Fire", "Trouble", "Supervisory"];

const COUNT_FIELD_BY_LABEL = {
  Fire: "totalFire",
  Trouble: "totalTrouble",
  Supervisory: "totalSupervisory",
};

/** POST a panel command; returns the raw response text, or null when the request failed. */
async function sendPanelCommand(command, { timeoutMs, expectedCount } = {}) {
  const res = await fetch(apiUrl("/api/telnet/fire-panel/command"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, timeoutMs, expectedCount }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return typeof data === "string" ? data : (data?.response || data?.raw || "");
}

/**
 * Reset all assets where simplexStatus F, T, or S > 0 back to 0 (one batched write).
 */
export async function resetAllAssetsSimplexStatus() {
  invalidateAssetsListSnapshotCache();
  clearAssetsListAddressIndex();
  clearTempPanelList();
  clearPanelListAssetSyncTempArray();
  useAssetFireStatusStore.getState().clearAllSimplexStatusInStore();

  const snapshot = await getAssetsListSnapshot(db);
  const now = new Date().toISOString();
  const cleared = { F: 0, T: 0, S: 0 };
  const batch = writeBatch(db);
  let batchSize = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const current = readSimplexStatus(data);
    if (current.F === 0 && current.T === 0 && current.S === 0) continue;

    batch.update(doc(db, "AssetsList", docSnap.id), {
      simplexStatus: cleared,
      updatedAt: now,
    });
    batchSize += 1;
    useAssetFireStatusStore.getState().patchSimplexStatusFromEntry(
      docSnap.id,
      data,
      cleared,
    );
  }

  if (batchSize > 0) {
    await batch.commit();
  }
}

/** Fresh `show counts` panel round-trip (not a DB read). */
async function fetchFreshCategoryCounts() {
  try {
    const rawText = await sendPanelCommand("show counts", { timeoutMs: 6000 });
    return rawText == null ? null : parseShowCountsResponse(rawText);
  } catch {
    return null;
  }
}

/** Save an (possibly empty) list for one category: {label}-list doc + AssetsList flags. */
async function applyCategoryList(label, parsedRows, addresses) {
  const mergedRows = syncPanelListWithTempArray(label, parsedRows);
  await Promise.all([
    saveListToCategoryDb(label, mergedRows),
    syncAssetsListWithPanelList(label, addresses),
  ]);
}

/**
 * One `list f|t|s` round: dump → {label}-list doc → AssetsList flags.
 * `expectedCount` comes from a `show counts` the caller already has; when it is
 * omitted a fresh `show counts` is sent first. A known count of 0 clears the
 * category without sending `list` at all. `skipIfCount`: skip the dump when the
 * count still equals the one the previous run just listed.
 * Returns the count it worked from.
 */
async function runCategoryListSync(label, { expectedCount, skipIfCount } = {}) {
  // An AutoPilot ack → login → silence → reset sequence must not have a list
  // dump typed into it (no-op when AutoPilot is not running).
  await waitForAutoPilotListHold();
  const listCmd = getListCmdForLabel(label);
  let expected = expectedCount;
  if (expected == null) {
    const counts = await fetchFreshCategoryCounts();
    expected = counts ? counts[COUNT_FIELD_BY_LABEL[label]] : null;
  }

  if (skipIfCount != null && expected != null && expected === skipIfCount) {
    return expected;
  }

  if (expected === 0) {
    await applyCategoryList(label, [], []);
    return expected;
  }

  // The worker extends its deadline while rows keep arriving and restarts the
  // dump itself if a priority command preempts it, so one retry is plenty.
  const timeoutMs = expected
    ? Math.max(15000, Math.min(60000, expected * 200 + 10000))
    : 20000;
  let rawText = "";
  let parsedRows = [];
  for (let attempt = 1; attempt <= 2; attempt++) {
    const response = await sendPanelCommand(listCmd, {
      timeoutMs,
      expectedCount: expected || undefined,
    });
    if (response == null) return expected;
    rawText = response;
    parsedRows = parsePanelListResponse(rawText);
    if (!expected || parsedRows.length >= Math.floor(expected * 0.95)) break;
    console.log(
      `[listSync] ${listCmd} returned ${parsedRows.length}/${expected} items (attempt ${attempt})`,
    );
  }

  await applyCategoryList(label, parsedRows, extractPanelDeviceAddresses(rawText));
  return expected;
}

const listSyncState = Object.fromEntries(
  CATEGORY_LABELS.map((label) => [label, { running: null, rerun: false, rerunOptions: null }]),
);

/**
 * Sync one category from the panel list. Single-flight per category: a call
 * made while a sync is running is not dropped — the sync runs once more when
 * the current one finishes (later calls coalesce into that one rerun).
 */
export function syncCategoryListAssets(label, options = {}) {
  const state = listSyncState[label];
  if (!state) return Promise.resolve();

  if (state.running) {
    state.rerun = true;
    state.rerunOptions = options;
    return state.running;
  }

  state.running = (async () => {
    let opts = options;
    try {
      for (;;) {
        state.rerun = false;
        let listedCount = null;
        try {
          listedCount = await runCategoryListSync(label, opts);
        } catch (err) {
          console.error(`[listSync] ${label} failed:`, err);
        }
        if (!state.rerun) break;
        // The queued run only re-lists when the panel count changed again.
        opts = { ...(state.rerunOptions || {}), skipIfCount: listedCount ?? undefined };
        state.rerunOptions = null;
      }
    } finally {
      state.running = null;
      useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
    }
  })();
  return state.running;
}

export const syncFireListAssets = (options) => syncCategoryListAssets("Fire", options);
export const syncTroubleListAssets = (options) => syncCategoryListAssets("Trouble", options);
export const syncSupervisoryListAssets = (options) =>
  syncCategoryListAssets("Supervisory", options);

let workflowInProgress = false;

/**
 * Post-system-reset sequence:
 * 1. Reset all devices with F/T/S > 0 to 0
 * 2. `show counts` → save totals to DB & UI
 * 3. `list f` / `list t` / `list s` only for categories with a non-zero count,
 *    each completing as soon as its expected row count arrives
 */
export async function handleSystemResetCompleteWorkflow() {
  if (workflowInProgress) return;
  workflowInProgress = true;

  try {
    await resetAllAssetsSimplexStatus();

    const counts = await fetchFreshCategoryCounts();
    if (counts) {
      await fetch(apiUrl("/api/telnet/fire-panel/panel-state"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalFire: counts.totalFire,
          totalSupervisory: counts.totalSupervisory,
          totalTrouble: counts.totalTrouble,
        }),
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("vision365:firePanelStateUpdated", { detail: counts }),
        );
      }
    }

    // The panel worker serializes the telnet side; DB writes for each category overlap.
    await Promise.allSettled(
      CATEGORY_LABELS.map((label) =>
        syncCategoryListAssets(label, {
          expectedCount: counts ? counts[COUNT_FIELD_BY_LABEL[label]] : undefined,
        }),
      ),
    );
  } catch (error) {
    console.error("[systemResetWorkflow] workflow failed:", error);
  } finally {
    workflowInProgress = false;
    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
  }
}
