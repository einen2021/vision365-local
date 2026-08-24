import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { apiUrl } from "@/lib/apiClient";
import { clearAssetsListAddressIndex } from "@/lib/assetsListSimplexStatus";
import { invalidateAssetsListSnapshotCache } from "@/lib/floorMapAssets";
import {
  clearTempPanelList,
  extractPanelDeviceAddresses,
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

/**
 * Reset all assets where simplexStatus F, T, or S > 0 back to 0.
 */
export async function resetAllAssetsSimplexStatus() {
  invalidateAssetsListSnapshotCache();
  clearAssetsListAddressIndex();
  clearTempPanelList();
  clearPanelListAssetSyncTempArray();
  useAssetFireStatusStore.getState().clearAllSimplexStatusInStore();

  const snapshot = await getDocs(collection(db, "AssetsList"));
  const now = new Date().toISOString();
  const cleared = { F: 0, T: 0, S: 0 };

  const updates = [];
  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const current = readSimplexStatus(data);
    if (current.F === 0 && current.T === 0 && current.S === 0) continue;

    updates.push(
      updateDoc(doc(db, "AssetsList", docSnap.id), {
        simplexStatus: cleared,
        updatedAt: now,
      }).then(() => {
        useAssetFireStatusStore.getState().patchSimplexStatusFromEntry(
          docSnap.id,
          data,
          cleared,
        );
      }),
    );
  }

  await Promise.all(updates);
}

let workflowInProgress = false;

/**
 * Executes the full post-system-reset sequence:
 * 1. Reset all devices with F/T/S > 0 to 0
 * 2. Run `list f` -> update F value to 1 for active fire devices
 * 3. Run `list t` -> update T value to 1 for active trouble devices
 * 4. Run `list s` -> update S value to 1 for active supervisory devices
 * 5. Run `show counts` -> update total counts in DB & UI
 */
export async function handleSystemResetCompleteWorkflow() {
  if (workflowInProgress) return;
  workflowInProgress = true;

  try {
    const sendCommand = async (command) => {
      const res = await fetch(apiUrl("/api/telnet/fire-panel/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, timeoutMs: 8000 }),
      });
      if (!res.ok) return "";
      const data = await res.json();
      return typeof data === "string" ? data : (data?.response || data?.raw || "");
    };

    // 1. Reset all devices with F or T or S > 0 to 0
    await resetAllAssetsSimplexStatus();

    // 2. Run `list f` and update F value to 1 (or clear the category if the response is empty)
    try {
      const resF = await sendCommand("list f", 15000);
      const parsedRows = parsePanelListResponse(resF);
      const fireAddresses = extractPanelDeviceAddresses(resF);
      syncPanelListWithTempArray("Fire", parsedRows);
      await saveListToCategoryDb("Fire", parsedRows);
      await syncAssetsListWithPanelList("Fire", fireAddresses);
    } catch (err) {
      console.error("[systemResetWorkflow] list f failed:", err);
      syncPanelListWithTempArray("Fire", []);
      await saveListToCategoryDb("Fire", []);
      await syncAssetsListWithPanelList("Fire", []);
    }

    // 3. Run `list t` and update T value to 1 (or clear the category if the response is empty)
    try {
      const resT = await sendCommand("list t", 20000);
      const parsedRows = parsePanelListResponse(resT);
      const troubleAddresses = extractPanelDeviceAddresses(resT);
      syncPanelListWithTempArray("Trouble", parsedRows);
      await saveListToCategoryDb("Trouble", parsedRows);
      await syncAssetsListWithPanelList("Trouble", troubleAddresses);
    } catch (err) {
      console.error("[systemResetWorkflow] list t failed:", err);
      syncPanelListWithTempArray("Trouble", []);
      await saveListToCategoryDb("Trouble", []);
      await syncAssetsListWithPanelList("Trouble", []);
    }

    // 4. Run `list s` and update S value to 1 (or clear the category if the response is empty)
    try {
      const resS = await sendCommand("list s", 15000);
      const parsedRows = parsePanelListResponse(resS);
      const supAddresses = extractPanelDeviceAddresses(resS);
      syncPanelListWithTempArray("Supervisory", parsedRows);
      await saveListToCategoryDb("Supervisory", parsedRows);
      await syncAssetsListWithPanelList("Supervisory", supAddresses);
    } catch (err) {
      console.error("[systemResetWorkflow] list s failed:", err);
      syncPanelListWithTempArray("Supervisory", []);
      await saveListToCategoryDb("Supervisory", []);
      await syncAssetsListWithPanelList("Supervisory", []);
    }

    // 5. Run `show counts` and sync counts to DB & UI
    try {
      const resCounts = await sendCommand("show counts");
      const counts = parseShowCountsResponse(resCounts);
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
    } catch (err) {
      console.error("[systemResetWorkflow] show counts failed:", err);
    }
  } catch (error) {
    console.error("[systemResetWorkflow] workflow failed:", error);
  } finally {
    workflowInProgress = false;
    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
  }
}

let syncFireListInProgress = false;

/**
 * Fresh `show counts` panel round-trip (not a DB read) — the stored panel-state
 * count is only refreshed by fetchAndSyncCounts(), which runs in a separate,
 * parallel call on new events, so it can still hold the pre-event value here.
 * A stale/zero expectedCount makes the worker finalize the list response on
 * the first line instead of waiting for the full count, truncating the list.
 */
async function fetchFreshCategoryCounts() {
  try {
    const res = await fetch(apiUrl("/api/telnet/fire-panel/command"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: "show counts", timeoutMs: 6000 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const rawText = typeof data === "string" ? data : (data?.response || data?.raw || "");
    return parseShowCountsResponse(rawText);
  } catch {
    return null;
  }
}

/**
 * Runs `list f` once after fire alarm / acknowledge, parses device addresses from the response,
 * saves to {fire}-list in DB, and updates matching devices' F value to 1 in AssetsList & store.
 */
export async function syncFireListAssets() {
  if (syncFireListInProgress) return;
  syncFireListInProgress = true;
  try {
    const counts = await fetchFreshCategoryCounts();
    const expectedCount = counts ? counts.totalFire : 0;
    const timeoutMs = Math.max(15000, Math.min(60000, expectedCount * 200 + 10000));
    console.log(`[syncFireListAssets] Requesting list f from panel (expecting ~${expectedCount})...`);

    let rawText = "";
    let parsedRows = [];
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(apiUrl("/api/telnet/fire-panel/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "list f", timeoutMs, expectedCount }),
      });
      if (!res.ok) return;
      const data = await res.json();
      rawText = typeof data === "string" ? data : (data?.response || data?.raw || "");
      parsedRows = parsePanelListResponse(rawText);

      const isCountConfirmed =
        expectedCount === 0 ||
        parsedRows.length >= expectedCount ||
        (parsedRows.length >= Math.floor(expectedCount * 0.95) && /_DNE|_END|\n-\s*$/i.test(rawText));
      if (isCountConfirmed) break;
      if (attempt < maxAttempts) {
        console.log(`[syncFireListAssets] list f returned ${parsedRows.length}/${expectedCount} items (attempt ${attempt}), retrying...`);
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    const fireAddresses = extractPanelDeviceAddresses(rawText);

    // Save complete list to DB history & in-memory cache
    syncPanelListWithTempArray("Fire", parsedRows);
    // Persist to fire-list DB — clears the category when the panel reports no active fire items.
    await saveListToCategoryDb("Fire", parsedRows);

    if (fireAddresses.length > 0) {
      console.log(`[syncFireListAssets] Found ${fireAddresses.length} fire device address(es):`, fireAddresses);
    } else {
      console.log("[syncFireListAssets] Fire list empty — clearing F flags.");
    }
    // Always run, even when empty, so stale F=1 flags get cleared once the last fire is acked.
    await syncAssetsListWithPanelList("Fire", fireAddresses);
  } catch (err) {
    console.error("[syncFireListAssets] failed:", err);
  } finally {
    syncFireListInProgress = false;
    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
  }
}

let syncTroubleListInProgress = false;

/**
 * Runs `list t` once after a new trouble event / acknowledge, parses device addresses
 * from the response, saves to {trouble}-list in DB, and updates matching devices' T
 * value to 1 in AssetsList & store.
 */
export async function syncTroubleListAssets() {
  if (syncTroubleListInProgress) return;
  syncTroubleListInProgress = true;
  try {
    const counts = await fetchFreshCategoryCounts();
    const expectedCount = counts ? counts.totalTrouble : 0;
    const timeoutMs = Math.max(20000, Math.min(60000, expectedCount * 200 + 10000));
    console.log(`[syncTroubleListAssets] Requesting list t from panel (expecting ~${expectedCount})...`);

    let rawText = "";
    let parsedRows = [];
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(apiUrl("/api/telnet/fire-panel/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "list t", timeoutMs, expectedCount }),
      });
      if (!res.ok) return;
      const data = await res.json();
      rawText = typeof data === "string" ? data : (data?.response || data?.raw || "");
      parsedRows = parsePanelListResponse(rawText);

      const isCountConfirmed =
        expectedCount === 0 ||
        parsedRows.length >= expectedCount ||
        (parsedRows.length >= Math.floor(expectedCount * 0.95) && /_DNE|_END|\n-\s*$/i.test(rawText));
      if (isCountConfirmed) break;
      if (attempt < maxAttempts) {
        console.log(`[syncTroubleListAssets] list t returned ${parsedRows.length}/${expectedCount} items (attempt ${attempt}), retrying...`);
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    const troubleAddresses = extractPanelDeviceAddresses(rawText);

    // Save complete list to DB history & in-memory cache
    syncPanelListWithTempArray("Trouble", parsedRows);
    // Persist to trouble-list DB — clears the category when the panel reports no active trouble items.
    await saveListToCategoryDb("Trouble", parsedRows);

    if (troubleAddresses.length > 0) {
      console.log(`[syncTroubleListAssets] Found ${troubleAddresses.length} trouble device address(es):`, troubleAddresses);
    } else {
      console.log("[syncTroubleListAssets] Trouble list empty — clearing T flags.");
    }
    // Always run, even when empty, so stale T=1 flags get cleared once the last trouble clears.
    await syncAssetsListWithPanelList("Trouble", troubleAddresses);
  } catch (err) {
    console.error("[syncTroubleListAssets] failed:", err);
  } finally {
    syncTroubleListInProgress = false;
    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
  }
}

let syncSupervisoryListInProgress = false;

/**
 * Runs `list s` once after a new supervisory event / acknowledge, parses device
 * addresses from the response, saves to {supervisory}-list in DB, and updates
 * matching devices' S value to 1 in AssetsList & store.
 */
export async function syncSupervisoryListAssets() {
  if (syncSupervisoryListInProgress) return;
  syncSupervisoryListInProgress = true;
  try {
    const counts = await fetchFreshCategoryCounts();
    const expectedCount = counts ? counts.totalSupervisory : 0;
    const timeoutMs = Math.max(15000, Math.min(60000, expectedCount * 200 + 10000));
    console.log(`[syncSupervisoryListAssets] Requesting list s from panel (expecting ~${expectedCount})...`);

    let rawText = "";
    let parsedRows = [];
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const res = await fetch(apiUrl("/api/telnet/fire-panel/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "list s", timeoutMs, expectedCount }),
      });
      if (!res.ok) return;
      const data = await res.json();
      rawText = typeof data === "string" ? data : (data?.response || data?.raw || "");
      parsedRows = parsePanelListResponse(rawText);

      const isCountConfirmed =
        expectedCount === 0 ||
        parsedRows.length >= expectedCount ||
        (parsedRows.length >= Math.floor(expectedCount * 0.95) && /_DNE|_END|\n-\s*$/i.test(rawText));
      if (isCountConfirmed) break;
      if (attempt < maxAttempts) {
        console.log(`[syncSupervisoryListAssets] list s returned ${parsedRows.length}/${expectedCount} items (attempt ${attempt}), retrying...`);
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    const supAddresses = extractPanelDeviceAddresses(rawText);

    // Save complete list to DB history & in-memory cache
    syncPanelListWithTempArray("Supervisory", parsedRows);
    // Persist to supervisory-list DB — clears the category when the panel reports no active supervisory items.
    await saveListToCategoryDb("Supervisory", parsedRows);

    if (supAddresses.length > 0) {
      console.log(`[syncSupervisoryListAssets] Found ${supAddresses.length} supervisory device address(es):`, supAddresses);
    } else {
      console.log("[syncSupervisoryListAssets] Supervisory list empty — clearing S flags.");
    }
    // Always run, even when empty, so stale S=1 flags get cleared once the last supervisory clears.
    await syncAssetsListWithPanelList("Supervisory", supAddresses);
  } catch (err) {
    console.error("[syncSupervisoryListAssets] failed:", err);
  } finally {
    syncSupervisoryListInProgress = false;
    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
  }
}
