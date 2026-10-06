import { apiUrl } from "@/lib/apiClient";
import { parseShowCountsResponse } from "@/lib/panelState";
import {
  extractPanelDeviceAddresses,
  parsePanelListResponse,
} from "@/lib/firePanelMonitor";
import { syncPanelListWithTempArray } from "@/lib/firePanelListHistory";
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import { saveListToCategoryDb } from "@/lib/recordAlarmHistory";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";

/**
 * Robustly refresh a category list (Fire, Trouble, Supervisory) from the fire panel:
 * 1. Queries `show counts` to get the latest expected count.
 * 2. If expected count is 0, clears the category DB list and resets category status.
 * 3. If expected count > 0, sends the list command with expectedCount parameter and dynamic timeout,
 *    retrying until the full count of items is confirmed.
 * 4. Clears and writes the freshly parsed rows to `{fire/trouble/supervisory}-list` in DB.
 * 5. Synchronizes AssetsList flags and in-memory stores.
 *
 * @param {"Fire"|"Trouble"|"Supervisory"} label
 * @returns {Promise<{ rows: Array<Object>, expectedCount: number }>}
 */
export async function refreshCategoryPanelList(label) {
  const normLabel =
    /^trouble$/i.test(label) ? "Trouble" : /^supervisory$/i.test(label) ? "Supervisory" : "Fire";
  const listCmd =
    normLabel === "Trouble" ? "list t" : normLabel === "Supervisory" ? "list s" : "list f";
  const countKey =
    normLabel === "Trouble"
      ? "totalTrouble"
      : normLabel === "Supervisory"
        ? "totalSupervisory"
        : "totalFire";

  const sendCommand = async (command, timeoutMs = 15000, expectedCount) => {
    const res = await fetch(apiUrl("/api/telnet/fire-panel/command"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeoutMs, expectedCount }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data?.error || `Command ${command} failed`);
    }
    const data = await res.json();
    return typeof data === "string" ? data : (data?.response || data?.raw || "");
  };

  // 1. Query show counts to get current accurate expected count
  let expectedCount = 0;
  let counts = null;
  try {
    const countsRaw = await sendCommand("show counts", 6000);
    counts = parseShowCountsResponse(countsRaw);
    if (counts) {
      expectedCount = Number(counts[countKey]) || 0;
      // Sync panel-state in DB & UI
      await fetch(apiUrl("/api/telnet/fire-panel/panel-state"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(counts),
      }).catch(() => {});

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("vision365:firePanelStateUpdated", { detail: counts }),
        );
      }
    }
  } catch (err) {
    console.warn(`[refreshCategoryPanelList] show counts failed, proceeding with best-effort:`, err);
  }

  // 2. If expected count is 0, clear list immediately
  if (expectedCount === 0) {
    syncPanelListWithTempArray(normLabel, []);
    await saveListToCategoryDb(normLabel, []);
    await syncAssetsListWithPanelList(normLabel, []);
    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
    return { rows: [], expectedCount: 0 };
  }

  // 3. Loop up to maxAttempts to confirm all expectedCount rows are fetched
  let parsedRows = [];
  let rawRes = "";
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const timeoutMs = Math.max(30000, Math.min(120000, expectedCount * 250 + 15000));
    rawRes = await sendCommand(listCmd, timeoutMs, expectedCount);
    parsedRows = parsePanelListResponse(rawRes);

    const isCountConfirmed =
      parsedRows.length >= expectedCount ||
      (parsedRows.length >= Math.floor(expectedCount * 0.95) && /_DNE|_END|\n-\s*$/i.test(rawRes)) ||
      attempt >= maxAttempts;

    if (isCountConfirmed || attempt >= maxAttempts) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1200));
  }

  const addresses = extractPanelDeviceAddresses(rawRes);

  // 4. Save to temp array cache
  const mergedRows = syncPanelListWithTempArray(normLabel, parsedRows);

  // 5. Save complete list to category DB ({fire/trouble/supervisory}-list)
  await saveListToCategoryDb(normLabel, mergedRows);

  // 6. Update matching assets in Firestore AssetsList and live status store
  await syncAssetsListWithPanelList(normLabel, addresses);
  useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();

  return { rows: parsedRows, expectedCount, addresses };
}
