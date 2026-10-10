import { apiUrl } from "@/lib/apiClient";
import { parseShowCountsResponse } from "@/lib/panelState";
import {
  extractPanelDeviceAddresses,
  parsePanelListResponse,
} from "@/lib/firePanelMonitor";
import { syncPanelListWithTempArray, getTempPanelList } from "@/lib/firePanelListHistory";
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import { resetAllAssetsSimplexStatus } from "@/lib/systemResetWorkflow";
import {
  recordNewElementsToHistory,
  saveListToCategoryDb,
} from "@/lib/recordAlarmHistory";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { useStartupProgressStore } from "@/stores/startupProgressStore";
import { isDebugMode } from "@/lib/debugMode";
import {
  deferForFirePriority,
  isHeldByFirePriority,
  noteShowCounts,
} from "@/lib/firePriority";

let startupSyncCompleted = false;
let startupSyncInProgress = false;

async function logStartupSync(message) {
  console.log(message);
  try {
    await fetch(apiUrl("/api/telnet/fire-panel/logs"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
  } catch {
    // ignore
  }
}

export function isStartupListSyncCompleted() {
  return startupSyncCompleted;
}

export function isStartupListSyncInProgress() {
  return startupSyncInProgress;
}

/**
 * Runs when the app starts up / opens and connects to the panel:
 * 1. Resets all assets with F, T, or S > 0 to 0.
 * 2. Runs `show counts` command to query totalFire, totalTrouble, totalSupervisory.
 * 3. If any count > 0, executes the corresponding `list` command sequentially.
 * 4. Confirms total count number of items are received before saving.
 * 5. Saves elements to DB ({fire/trouble/supervisory}-list and building live history).
 * 6. Logs saving complete message to console.
 * 7. Updates matching assets' F, T, S values to 1 in AssetsList & store.
 * 8. Strictly awaits saving all elements of the previous command before running the next!
 * 9. Once all data is saved, closes the splash screen.
 */
export async function runStartupListSync(arg1, arg2) {
  let setFirePanelListResponses = null;
  let onProgress = null;

  if (typeof arg1 === "function") {
    setFirePanelListResponses = arg1;
    if (typeof arg2 === "function") {
      onProgress = arg2;
    }
  } else if (arg1 && typeof arg1 === "object") {
    setFirePanelListResponses = arg1.setFirePanelListResponses || null;
    onProgress = arg1.onProgress || null;
  }

  const reportProgress = (step, total, percent, message) => {
    useStartupProgressStore.getState().setProgress({
      step,
      total: total || 12,
      percent,
      message,
    });
    if (typeof onProgress === "function") {
      try {
        onProgress({ step, total: total || 12, percent, message });
      } catch {
        // ignore
      }
    }
  };

  if (startupSyncCompleted) {
    if (setFirePanelListResponses) {
      for (const label of ["Fire", "Trouble", "Supervisory"]) {
        const rows = getTempPanelList(label);
        setFirePanelListResponses((prev) => ({
          ...prev,
          [label]: {
            ...(prev[label] || {}),
            rows,
            fetchedAt: prev[label]?.fetchedAt || new Date().toISOString(),
          },
        }));
      }
    }
    reportProgress(12, 12, 100, "Application ready");
    useStartupProgressStore.getState().closeSplash();
    return;
  }

  if (startupSyncInProgress) return;
  startupSyncInProgress = true;

  try {
    const sendCommand = async (command, timeoutMs = 15000, expectedCount) => {
      const res = await fetch(apiUrl("/api/telnet/fire-panel/command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, timeoutMs, expectedCount }),
      });
      if (!res.ok) return "";
      const data = await res.json();
      return typeof data === "string" ? data : (data?.response || data?.raw || "");
    };

    // Step 7: Run `show counts` (with retry attempts) — first, so the reset
    // below knows whether a fire is active (fire first: T / S are then held).
    reportProgress(7, 12, 60, "Checking fire panel counts...");
    let counts = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      await logStartupSync(`[startupSync] Querying show counts on app startup (attempt ${attempt}/2)...`);
      const countsRaw = await sendCommand("show counts", 6000);
      counts = parseShowCountsResponse(countsRaw);
      if (counts) break;
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    noteShowCounts(counts);

    // Step 8: Reset all assets F, T, S values to 0 (F only while FIRE > 0)
    reportProgress(8, 12, 68, "Resetting device status (F/T/S to 0)...");
    await logStartupSync("[startupSync] Resetting all assets F/T/S values to 0 before list commands...");
    await resetAllAssetsSimplexStatus();

    if (!counts && isDebugMode()) {
      await logStartupSync(
        "[startupSync] [Debug Mode] Fire panel not connected. Using hardcoded demo counts...",
      );
      counts = {
        totalFire: 0,
        totalTrouble: 6,
        totalSupervisory: 4,
      };
    }

    const totalFire = counts ? counts.totalFire : 0;
    const totalTrouble = counts ? counts.totalTrouble : 0;
    const totalSupervisory = counts ? counts.totalSupervisory : 0;

    if (counts) {
      await logStartupSync(
        `[startupSync] Initial counts: Fire=${totalFire}, Trouble=${totalTrouble}, Supervisory=${totalSupervisory}`,
      );
      reportProgress(
        8,
        12,
        72,
        `Panel counts: Fire: ${totalFire} | Trouble: ${totalTrouble} | Supervisory: ${totalSupervisory}`,
      );
      // Save initial counts to database and dispatch event for realtime UI update
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

    // Helper to fetch, confirm count, and save a category list
    const fetchConfirmAndSaveCategory = async (
      label,
      listCmd,
      expectedCount = 0,
      stepNum = 9,
      basePercent = 75,
    ) => {
      const docName = `${label.toLowerCase()}-list`;

      // Fire first: no `list t` / `list s` while FIRE > 0 — re-listed once it is 0.
      if (isHeldByFirePriority(label)) {
        deferForFirePriority(label);
        await logStartupSync(`[startupSync] Fire active — ${listCmd} held until the fire count is 0.`);
        reportProgress(stepNum, 12, basePercent + 8, `${label} list held — fire alarm active.`);
        return [];
      }

      if (expectedCount === 0) {
        reportProgress(stepNum, 12, basePercent + 5, `Saving ${label} list to database (0 items)...`);
        syncPanelListWithTempArray(label, []);
        await saveListToCategoryDb(label, []);
        await syncAssetsListWithPanelList(label, []);
        if (setFirePanelListResponses) {
          setFirePanelListResponses((prev) => ({
            ...prev,
            [label]: { response: "", rows: [], fetchedAt: new Date().toISOString() },
          }));
        }
        await logStartupSync(`[startupSync] Saving ${docName} to DB complete (0 items).`);
        reportProgress(stepNum, 12, basePercent + 8, `${label} list synchronized (0 items).`);
        return [];
      }

      reportProgress(
        stepNum,
        12,
        basePercent,
        `Fetching ${label} alarms (${expectedCount} items expected)...`,
      );
      await logStartupSync(`[startupSync] Running ${listCmd} (expecting ~${expectedCount} items)...`);

      let parsedRows = [];
      let rawRes = "";
      const maxAttempts = 2;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const timeoutMs = Math.max(30000, Math.min(120000, expectedCount * 250 + 15000));
        rawRes = await sendCommand(listCmd, timeoutMs, expectedCount);
        // A fire that started meanwhile (the panel worker then refuses the list).
        if (isHeldByFirePriority(label)) break;
        parsedRows = parsePanelListResponse(rawRes);

        // Fallback for debug mode if connection is absent or returned empty
        if ((!rawRes || parsedRows.length === 0) && isDebugMode()) {
          if (label === "Fire") {
            rawRes = "";
          } else if (label === "Trouble") {
            rawRes = [
              "2:M1-10-0   GROUND FL MAIN ENTRANCE           SMOKE DETECTOR       TRBL*",
              "2:M1-45-0   FIRST FLOOR CORRIDOR 104          PULL STATION         TRBL*",
              "2:M1-102-0  BASEMENT 1 PUMP ROOM              PHOTO DETECTOR       TRBL*",
              "2:M1-202-0  SUB BS PMP RM WET RSR VA TUB31    SUPERVISORY MONITOR  TRBL*",
              "2:M2-15-0   ROOF ELEVATOR MACHINE ROOM        HEAT DETECTOR        TRBL*",
              "P104        PANEL 2 POWER SUPPLY BATTERY      SYSTEM POWER SUPPLY  TRBL*",
              "-",
            ].join("\n");
          } else if (label === "Supervisory") {
            rawRes = [
              "2:M1-202-0  SUB BS PMP RM WET RSR VA TUB31    SUPERVISORY MONITOR  SUPV*",
              "2:M1-215-0  BASEMENT 2 SPRINKLER VALVE 4      SUPERVISORY MONITOR  SUPV*",
              "2:M2-30-0   GROUND FLOOR OS&Y VALVE           SUPERVISORY MONITOR  SUPV*",
              "2:M2-88-0   FLOOR 3 ZONE VALVE TAMPER         SUPERVISORY MONITOR  SUPV*",
              "-",
            ].join("\n");
          }
          parsedRows = parsePanelListResponse(rawRes);
          await logStartupSync(
            `[startupSync] [Debug Mode] Hardcoded demo list loaded for ${label}: ${parsedRows.length} item(s)`,
          );
          break;
        }

        // Confirm whether total count number of items were received
        const isCountConfirmed =
          parsedRows.length >= expectedCount ||
          (parsedRows.length >= Math.floor(expectedCount * 0.95) && /_DNE|_END|\n-\s*$/i.test(rawRes)) ||
          attempt >= maxAttempts;

        if (isCountConfirmed || attempt >= maxAttempts) {
          if (attempt >= maxAttempts && parsedRows.length < expectedCount) {
            await logStartupSync(
              `[startupSync] ${listCmd} completed after max ${attempt} attempts (${parsedRows.length}/${expectedCount} items received). Moving to saving step...`,
            );
            reportProgress(
              stepNum,
              12,
              basePercent + 4,
              `${label} finished 2 attempts (${parsedRows.length}/${expectedCount} items). Moving to saving step...`,
            );
          }
          break;
        }

        reportProgress(
          stepNum,
          12,
          basePercent + Math.min(4, attempt),
          `Fetching ${label} alarms: ${parsedRows.length}/${expectedCount} items (attempt ${attempt}/2)...`,
        );
        await logStartupSync(
          `[startupSync] ${listCmd} attempt ${attempt}/2 received ${parsedRows.length}/${expectedCount} items. Retrying attempt 2/2...`,
        );
        await new Promise((r) => setTimeout(r, 1500));
      }

      if (isHeldByFirePriority(label)) {
        deferForFirePriority(label);
        await logStartupSync(`[startupSync] Fire active — ${listCmd} result dropped, re-listed once the fire count is 0.`);
        reportProgress(stepNum, 12, basePercent + 8, `${label} list held — fire alarm active.`);
        return [];
      }

      reportProgress(
        stepNum,
        12,
        basePercent + 5,
        `Saving ${label} list to database (${parsedRows.length} items)...`,
      );
      const addresses = extractPanelDeviceAddresses(rawRes);

      // 1. Save to temp array cache
      const mergedRows = syncPanelListWithTempArray(label, parsedRows);

      // 2. Save complete list to category DB ({fire/trouble/supervisory}-list)
      await saveListToCategoryDb(label, mergedRows);

      // 3. Update matching assets in Firestore AssetsList and live status store
      await syncAssetsListWithPanelList(label, addresses);

      // 4. Update frontend state
      if (setFirePanelListResponses) {
        setFirePanelListResponses((prev) => ({
          ...prev,
          [label]: { response: rawRes, rows: parsedRows, fetchedAt: new Date().toISOString() },
        }));
      }

      // 5. Log saving complete message in log console (and do not run again)
      await logStartupSync(`[startupSync] Saving ${docName} to DB complete (${parsedRows.length} items).`);
      reportProgress(
        stepNum,
        12,
        basePercent + 8,
        `${label} data saved (${parsedRows.length} items).`,
      );
      return parsedRows;
    };

    // Step 9: Process Fire list
    await fetchConfirmAndSaveCategory("Fire", "list f", totalFire, 9, 74);

    // Step 10: Process Trouble list
    await fetchConfirmAndSaveCategory("Trouble", "list t", totalTrouble, 10, 83);

    // Step 11: Process Supervisory list
    await fetchConfirmAndSaveCategory("Supervisory", "list s", totalSupervisory, 11, 92);

    startupSyncCompleted = true;
    reportProgress(12, 12, 100, "All panel data saved. Launching Vision365...");
    await logStartupSync("[startupSync] All startup list commands, DB saving, and asset updates completed successfully.");

    await new Promise((r) => setTimeout(r, 400));
    useStartupProgressStore.getState().closeSplash();
  } catch (error) {
    console.error("[startupSync] Error during startup list synchronization:", error);
    reportProgress(12, 12, 100, "Synchronization finished with warnings.");
    await new Promise((r) => setTimeout(r, 400));
    useStartupProgressStore.getState().closeSplash();
  } finally {
    startupSyncInProgress = false;
    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
  }
}
