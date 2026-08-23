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
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import { saveListToCategoryDb } from "@/lib/recordAlarmHistory";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/**
 * Reset all assets where simplexStatus F, T, or S > 0 back to 0.
 */
export async function resetAllAssetsSimplexStatus() {
  invalidateAssetsListSnapshotCache();
  clearAssetsListAddressIndex();
  clearTempPanelList();
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

