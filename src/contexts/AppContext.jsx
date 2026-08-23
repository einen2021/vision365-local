"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FireAlertModal } from "@/components/fire-alert-modal";
import { usePathname } from "next/navigation";
import secureLocalStorage from "react-secure-storage";
import { collection as mockCollection, getDocs as mockGetDocs } from "@/lib/mockFirestore";
import { collection, doc, getDoc, getDocs, updateDoc } from "firebase/firestore";
import { getUserCommunities } from "@/utils/communityService";
import { loadBrandRegistry } from "@/utils/brandRegistryService";
import { getStoredSessionUser } from "@/lib/sessionUser";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { apiFetch, parseApiJsonResponse } from "@/lib/apiClient";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { db } from "@/config/firebase";
import {
  CVAL_COMMANDS,
  MONITOR_INTERVAL_MS,
  PANEL_STATE_REFRESH_MS,
  LIST_COMMAND_TIMEOUT_MS,
  countListMessages,
  extractCVal,
  extractPanelDeviceAddresses,
  getExpectedListCountForLabel,
  getListCmdForLabel,
  isListResponseComplete,
  isListResponseReady,
  parsePanelListResponse,
  readSimplexStatus,
  simplexKeyForCategoryLabel,
} from "@/lib/firePanelMonitor";
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import {
  findAssetsListDocByLocationText,
  findDeviceAddressByLocationText as findDeviceAddressByLocationTextLib,
} from "@/lib/assetsListSimplexStatus";
import { extractFloorDetailsFromAsset } from "@/lib/assetAddressFloorIndex";
import { streamFirePanelListCommand } from "@/lib/firePanelListStream";
import { pickNewestAppearedAddresses } from "@/lib/livePanelListHighlight";
import {
  isFirePanelMonitoringPersisted,
  isMonitorLoopActive,
  isMonitorLoopPaused,
  setFirePanelMonitoringPersisted,
  setMonitorCycleRunning,
  setMonitorLoopActive,
  withMonitorPaused,
} from "@/lib/firePanelMonitorSession";
import { useFireAlert } from "./FireModalContext";
import { useDeviceEnabledStore } from "@/stores/deviceEnabledStore";
import { LivePanelAlertWatcher } from "@/components/live-panel-alert-watcher";
import { useLivePanelAlert } from "@/contexts/LivePanelAlertContext";
import {
  LIVE_SUPERVISORY_ROUTE,
  LIVE_TROUBLE_ROUTE,
} from "@/config/live-panel-routes";

/**
 * Simplified AppContext for admin-only JSON-backed app.
 * All data is loaded from data/db.json via mock Firestore.
 */

const AppContext = createContext(undefined);

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
};

/** Fire-panel monitor fields — use on Network page only to avoid re-rendering the whole app. */
export const useFirePanelMonitor = () => {
  const {
    firePanelMonitoring,
    firePanelMonitorLogs,
    firePanelState,
    firePanelStateLoading,
    startFirePanelMonitoring,
    stopFirePanelMonitoring,
    toggleFirePanelMonitoring,
    fetchFirePanelState,
    systemReset,
    silenceAlarm,
    acknowledge,
    firePanelListResponses,
    fetchFirePanelListResponse,
    disableDevice,
    enableDevice,
    findDeviceAddressByLocationText,
    findFloorDetailsByLocationText,
  } = useApp();
  return {
    firePanelMonitoring,
    firePanelMonitorLogs,
    firePanelState,
    firePanelStateLoading,
    startFirePanelMonitoring,
    stopFirePanelMonitoring,
    toggleFirePanelMonitoring,
    fetchFirePanelState,
    systemReset,
    silenceAlarm,
    acknowledge,
    firePanelListResponses,
    fetchFirePanelListResponse,
    disableDevice,
    enableDevice,
    findDeviceAddressByLocationText,
    findFloorDetailsByLocationText,
  };
};

export const AppProvider = ({ children }) => {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [effectiveFetchRole, setEffectiveFetchRole] = useState("admin");
  const [userEmail, setUserEmail] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeDevices, setActiveDevices] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [globalAssets, setGlobalAssets] = useState([]);
  const [brandRegistry, setBrandRegistry] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [allBuildings, setAllBuildings] = useState([]);

  const [selectedCommunity, setSelectedCommunity] = useState(null);
  const [selectedBuilding, setSelectedBuilding] = useState(null);
  const [buildingCache, setBuildingCache] = useState({});

  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);
  const [error, setError] = useState(null);
  const [loadingStates, setLoadingStates] = useState({
    communities: false,
    assets: false,
    brands: false,
    staff: false,
    jobs: false,
  });

  // Global fire alert modal
  const [isFireAlertOpen, setIsFireAlertOpen] = useState(false);
  const openFireAlertModal = useCallback(() => setIsFireAlertOpen(true), []);
  const closeFireAlertModal = useCallback(() => setIsFireAlertOpen(false), []);

  const { showFireAlert, muteSiren, unmuteSiren } = useFireAlert();
  const { showTroubleAlert, showSupervisoryAlert } = useLivePanelAlert();

  // Global fire-panel CVAL monitor (persists across routes and reloads)
  const [firePanelMonitoring, setFirePanelMonitoring] = useState(
    () => isFirePanelMonitoringPersisted(),
  );
  const [firePanelMonitorLogs, setFirePanelMonitorLogs] = useState([]);
  const [firePanelState, setFirePanelState] = useState(null);
  const [firePanelStateLoading, setFirePanelStateLoading] = useState(true);
  const [firePanelListResponses, setFirePanelListResponses] = useState({
    Fire: null,
    Trouble: null,
    Supervisory: null,
  });
  const firePanelStateRef = useRef(null);
  const firePanelWasConnectedRef = useRef(false);
  const pendingMonitorLogsRef = useRef([]);
  const monitorLogFlushTimerRef = useRef(null);
  // Last known addresses per list category — used to stamp only the newest device.
  const previousListAddressesRef = useRef({
    Fire: [],
    Trouble: [],
    Supervisory: [],
  });
  // Newest device from the most recent list parse (readable before React state flushes).
  const lastListNewestRef = useRef({
    Fire: null,
    Trouble: null,
    Supervisory: null,
  });
  // One list fetch per category when CVAL > 0 but we have no cached addresses yet.
  const listBootstrappedRef = useRef({
    Fire: false,
    Trouble: false,
    Supervisory: false,
  });

  /** Push one polled CVAL into React state as soon as the panel responds. */
  const syncFirePanelFieldToUi = useCallback((field, value) => {
    const prev = firePanelStateRef.current ?? {
      totalFire: 0,
      totalSupervisory: 0,
      totalTrouble: 0,
      lastPanelSync: null,
      lastPolledAt: null,
    };
    const num = Number(value) || 0;
    if (prev[field] === num) return;

    const next = {
      ...prev,
      [field]: num,
      lastPolledAt: new Date().toISOString(),
    };
    firePanelStateRef.current = next;
    setFirePanelState(next);
  }, []);

  /** Push all polled CVAL totals into React state (e.g. system reset). */
  const syncFirePanelCountsToUi = useCallback((counts) => {
    const next = {
      totalFire: Number(counts.totalFire) || 0,
      totalSupervisory: Number(counts.totalSupervisory) || 0,
      totalTrouble: Number(counts.totalTrouble) || 0,
      lastPanelSync: firePanelStateRef.current?.lastPanelSync ?? null,
      lastPolledAt: new Date().toISOString(),
    };
    const prev = firePanelStateRef.current;
    if (
      prev &&
      prev.totalFire === next.totalFire &&
      prev.totalSupervisory === next.totalSupervisory &&
      prev.totalTrouble === next.totalTrouble &&
      prev.lastPolledAt === next.lastPolledAt
    ) {
      return;
    }
    firePanelStateRef.current = next;
    setFirePanelState(next);
  }, []);

  const firePanelConnected = useFirePanelStore((s) => s.connected);

  const flushFirePanelMonitorLogs = useCallback(() => {
    if (pendingMonitorLogsRef.current.length === 0) return;
    const batch = pendingMonitorLogsRef.current;
    pendingMonitorLogsRef.current = [];
    setFirePanelMonitorLogs((prev) => [...prev, ...batch].slice(-300));
  }, []);

  const appendFirePanelMonitorLog = useCallback((line) => {
    const entry = `[${new Date().toLocaleTimeString()}] ${line}`;
    pendingMonitorLogsRef.current.push(entry);
    if (!monitorLogFlushTimerRef.current) {
      monitorLogFlushTimerRef.current = setTimeout(() => {
        monitorLogFlushTimerRef.current = null;
        flushFirePanelMonitorLogs();
      }, 300);
    }
  }, [flushFirePanelMonitorLogs]);


  const sendFirePanelCommand = useCallback(async (cmd, timeoutMs = 3000) => {
    const runOnce = async () => {
      const res = await apiFetch("/api/telnet/fire-panel/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd, timeoutMs }),
      });
      const data = await parseApiJsonResponse(res);
      if (!res.ok) {
        const message = data?.error || "Command failed";
        if (/not connected/i.test(message)) {
          useFirePanelStore.getState().markDisconnected(message);
        }
        throw new Error(message);
      }
      return data.response || "";
    };

    try {
      return await runOnce();
    } catch (error) {
      if (/not connected/i.test(error.message || "")) {
        await useFirePanelStore.getState().syncStatus();
        if (useFirePanelStore.getState().connected) return await runOnce();
      }
      throw error;
    }
  }, []);

  const acknowledge = useCallback(async (label, deviceAddress = null) => {
    // Device row → ack f {address}; modal / category → ack f.
    const { acknowledgeDevice, acknowledgeCategory } = await import(
      "@/lib/acknowledgePanelDevice"
    );
    if (deviceAddress) {
      return acknowledgeDevice(label, deviceAddress);
    }
    return acknowledgeCategory(label);
  }, []);

  const storeFirePanelListResponse = useCallback((label, listCmd, response, meta = {}) => {
    const addresses = extractPanelDeviceAddresses(response);
    const previous = previousListAddressesRef.current[label] || [];
    const newlyAppeared = pickNewestAppearedAddresses(addresses, previous);
    const fetchedAt = new Date().toISOString();

    let newestAddress = String(meta.newestAddress || "").trim();
    if (!newestAddress && newlyAppeared.length > 0) {
      // Diff-based newest. Skip first baseline seed unless this list is from a CVAL increase.
      if (previous.length > 0 || meta.markNewest) {
        newestAddress = newlyAppeared[newlyAppeared.length - 1];
      }
    }
    // First monitor increment before any baseline: take the last address in the list.
    if (
      !newestAddress &&
      meta.markNewest &&
      previous.length === 0 &&
      addresses.length > 0
    ) {
      newestAddress = addresses[addresses.length - 1];
    }

    const statusKey = simplexKeyForCategoryLabel(label);
    useAssetFireStatusStore
      .getState()
      .syncPanelLiveFlagsForCategory(statusKey, addresses, previous);

    previousListAddressesRef.current[label] = addresses;
    lastListNewestRef.current[label] = newestAddress
      ? { address: newestAddress, at: fetchedAt }
      : null;

    setFirePanelListResponses((prev) => {
      let nextNewest = newestAddress;
      if (!nextNewest) {
        const prior = String(prev[label]?.newestAddress || "").trim();
        const stillActive = addresses.some(
          (address) =>
            String(address).trim().toUpperCase() === prior.toUpperCase(),
        );
        if (stillActive) nextNewest = prior;
      }

      return {
        ...prev,
        [label]: {
          listCmd,
          response: String(response || ""),
          fetchedAt,
          streaming: false,
          newestAddress: nextNewest || "",
        },
      };
    });
  }, []);

  const updateStreamingListResponse = useCallback((label, listCmd, response, streaming) => {
    setFirePanelListResponses((prev) => ({
      ...prev,
      [label]: {
        listCmd,
        response: String(response || ""),
        fetchedAt: prev[label]?.fetchedAt ?? new Date().toISOString(),
        streaming: Boolean(streaming),
        newestAddress: prev[label]?.newestAddress || "",
      },
    }));
  }, []);

  const sendFirePanelListCommandAndWait = useCallback(
    async (listCmd, label = null, options = {}) => {
      const { onPartial, markNewest = false, expectedCount: expectedOverride } = options;

      // Complete around CVAL totalFire / totalTrouble / totalSupervisory.
      const expectedCount =
        expectedOverride != null && Number.isFinite(Number(expectedOverride))
          ? Number(expectedOverride)
          : label
            ? getExpectedListCountForLabel(label, firePanelStateRef.current)
            : null;

      appendFirePanelMonitorLog(
        `>> ${listCmd} (${label ? "streaming" : "waiting for"} dump${
          expectedCount != null ? `, expect ~${expectedCount} message(s)` : ""
        }...)`,
      );

      const response = label
        ? await streamFirePanelListCommand(
            listCmd,
            LIST_COMMAND_TIMEOUT_MS,
            (partial, done) => {
              // Always push partials to UI so Live Trouble/Fire fills while dumping.
              // Mark streaming done when worker says done OR we already hit CVAL count.
              const enough =
                done ||
                (expectedCount != null &&
                  isListResponseReady(partial, expectedCount));
              updateStreamingListResponse(label, listCmd, partial, !done && !enough);
              onPartial?.(partial, done);
            },
            { expectedCount },
          )
        : await sendFirePanelCommand(listCmd, LIST_COMMAND_TIMEOUT_MS);

      const messageCount = countListMessages(response);
      if (isListResponseReady(response, expectedCount)) {
        appendFirePanelMonitorLog(
          `<< ${listCmd} complete (${messageCount}${
            expectedCount != null ? `/${expectedCount}` : ""
          } message(s), ${response.length} chars)`,
        );
      } else {
        appendFirePanelMonitorLog(
          `!! ${listCmd}: best effort — have ${messageCount}${
            expectedCount != null ? `/${expectedCount}` : ""
          } message(s)`,
        );
      }

      if (label) {
        storeFirePanelListResponse(label, listCmd, response, {
          markNewest,
          expectedCount,
        });
      }
      return response;
    },
    [
      appendFirePanelMonitorLog,
      sendFirePanelCommand,
      storeFirePanelListResponse,
      updateStreamingListResponse,
    ],
  );

  const fetchFirePanelListResponse = useCallback(
    async (label) => {
      const listCmd = getListCmdForLabel(label);
      if (!listCmd) {
        throw new Error(`Unknown list label: ${label}`);
      }

      // Mark streaming/loading state immediately so UI turns on spinner instantly
      setFirePanelListResponses((prev) => ({
        ...prev,
        [label]: {
          ...(prev[label] || {}),
          listCmd,
          streaming: true,
        },
      }));

      // Pause CVAL polling so list t/f/s can finish without being cut off.
      return withMonitorPaused(async () => {
        try {
          const response = await sendFirePanelListCommandAndWait(listCmd, label);
          const rowCount = parsePanelListResponse(response).length;
          const addressCount = extractPanelDeviceAddresses(response).length;
          appendFirePanelMonitorLog(
            `<< ${listCmd} parsed ${rowCount} row(s), ${addressCount} address(es)${
              isListResponseComplete(response) ? "" : " (best effort — no _DNE)"
            }`,
          );

          return {
            listCmd,
            response,
            fetchedAt: new Date().toISOString(),
          };
        } catch (error) {
          setFirePanelListResponses((prev) => ({
            ...prev,
            [label]: {
              ...(prev[label] || {}),
              streaming: false,
            },
          }));
          throw error;
        }
      });
    },
    [appendFirePanelMonitorLog, sendFirePanelListCommandAndWait],
  );

  const saveFirePanelState = useCallback(async (counts) => {
    const payload = {
      totalFire: Number(counts.totalFire),
      totalSupervisory: Number(counts.totalSupervisory),
      totalTrouble: Number(counts.totalTrouble),
    };
    if (
      !Number.isFinite(payload.totalFire) ||
      !Number.isFinite(payload.totalSupervisory) ||
      !Number.isFinite(payload.totalTrouble)
    ) {
      throw new Error("totalFire, totalTrouble, and totalSupervisory are required");
    }

    const res = await apiFetch("/api/telnet/fire-panel/panel-state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await parseApiJsonResponse(res);
    if (!res.ok) throw new Error(data?.error || "Failed to save panel state");

    const nextState = {
      totalFire: Number(data.totalFire ?? payload.totalFire) || 0,
      totalSupervisory: Number(data.totalSupervisory ?? payload.totalSupervisory) || 0,
      totalTrouble: Number(data.totalTrouble ?? payload.totalTrouble) || 0,
      lastPanelSync:
        typeof data.lastPanelSync === "string"
          ? data.lastPanelSync
          : firePanelStateRef.current?.lastPanelSync ?? null,
      lastPolledAt: firePanelStateRef.current?.lastPolledAt ?? null,
    };
    firePanelStateRef.current = nextState;
    // During monitoring, per-field polls own the live totals — only refresh DB timestamp.
    if (!isMonitorLoopActive()) {
      setFirePanelState(nextState);
    } else if (nextState.lastPanelSync) {
      setFirePanelState((prev) => ({
        ...(prev ?? nextState),
        lastPanelSync: nextState.lastPanelSync,
      }));
    }
    return { ...data, ...nextState };
  }, []);

  const stopFirePanelMonitoring = useCallback(() => {
    setMonitorLoopActive(false);
    setFirePanelMonitoringPersisted(false);
    setFirePanelMonitoring(false);
    useAssetFireStatusStore.getState().stopPolling();
    appendFirePanelMonitorLog("--- stopped ---");
    flushFirePanelMonitorLogs();
  }, [appendFirePanelMonitorLog, flushFirePanelMonitorLogs]);

  const silenceAlarm = useCallback(async () => {
    muteSiren()
    const loginResponse = await sendFirePanelCommand("login 333");
    if (!loginResponse.includes("ACCESS GRANTED")) {
      throw new Error("Panel login failed");
    }
    return [await sendFirePanelListCommandAndWait("set 2:p217 on"), await sendFirePanelListCommandAndWait("set 3:p217 on"), await sendFirePanelListCommandAndWait("set 4:p217 on")];
  }, []);

  const systemReset = useCallback(async () => {
    const loginResponse = await sendFirePanelCommand("login 333");
    if (!loginResponse.includes("ACCESS GRANTED")) {
      throw new Error("Panel login failed");
    }

    await sendFirePanelListCommandAndWait("set 2:p212 on");
    await sendFirePanelListCommandAndWait("set 3:p212 on");
    await sendFirePanelListCommandAndWait("set 4:p212 on");

    // Reflect reset in header badges immediately after the panel accepts the command.
    syncFirePanelCountsToUi({
      totalFire: 0,
      totalSupervisory: 0,
      totalTrouble: 0,
    });

    // Turn floor markers green immediately while Firestore catches up.
    useAssetFireStatusStore.getState().clearAllSimplexStatusInStore();

    const runBackgroundReset = async () => {
      try {
        const snapshot = await getDocs(collection(db, "AssetsList"));
        const now = new Date().toISOString();
        const cleared = { F: 0, T: 0, S: 0 };

        const updates = snapshot.docs.map(async (docSnap) => {
          const data = docSnap.data();
          const current = readSimplexStatus(data);

          if (current.F === 0 && current.T === 0 && current.S === 0) {
            return;
          }

          await updateDoc(doc(db, "AssetsList", docSnap.id), {
            simplexStatus: cleared,
            updatedAt: now,
          });

          useAssetFireStatusStore.getState().patchSimplexStatusFromEntry(
            docSnap.id,
            data,
            cleared,
          );
        });

        await Promise.all(updates);

        await saveFirePanelState({
          totalFire: 0,
          totalSupervisory: 0,
          totalTrouble: 0,
        });
        appendFirePanelMonitorLog("System reset → cleared F/T/S on AssetsList");
      } catch (error) {
        appendFirePanelMonitorLog(`!! system reset background: ${error.message}`);
        console.error("[system reset] background cleanup failed:", error);
      } finally {
        useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
      }
    };

    void runBackgroundReset();
  }, [
    appendFirePanelMonitorLog,
    saveFirePanelState,
    sendFirePanelCommand,
    sendFirePanelListCommandAndWait,
    syncFirePanelCountsToUi,
  ]);


  const disableDevice = useCallback(async (deviceAddress) => {
    return withMonitorPaused(async () => {
      const loginResponse = await sendFirePanelCommand("login 333");
      if (!loginResponse.includes("ACCESS GRANTED")) {
        throw new Error("Panel login failed");
      }
      const disableResponse = await sendFirePanelCommand(`disable ${deviceAddress} on`);
      useDeviceEnabledStore.getState().setEnabled(deviceAddress, false);
      return disableResponse;
    });
  }, [sendFirePanelCommand]);

  const enableDevice = useCallback(async (deviceAddress) => {
    return withMonitorPaused(async () => {
      const loginResponse = await sendFirePanelCommand("login 333");
      if (!loginResponse.includes("ACCESS GRANTED")) {
        throw new Error("Panel login failed");
      }
      const enableResponse = await sendFirePanelCommand(`disable ${deviceAddress} off`);
      useDeviceEnabledStore.getState().setEnabled(deviceAddress, true);
      return enableResponse;
    });
  }, [sendFirePanelCommand]);

  /**
   * Match a fire-panel-printed location string (e.g. "SUB BS CORRIDOR COS 21 SB/L1/2")
   * against AssetsList and return the matched asset's device address, or "" when
   * nothing matches. Shared with src/lib/recordAlarmHistory.js so live fire/trouble/
   * supervisory log entries can resolve an address without a `list f/t/s` round-trip.
   */
  const findDeviceAddressByLocationText = useCallback(
    (locationText) => findDeviceAddressByLocationTextLib(locationText),
    [],
  );

  /**
   * Match a fire-panel-printed location string against AssetsList and return the
   * matched asset's floor-plan placement details (building, floor, section,
   * subsection, etc.), or null when nothing matches / the asset isn't placed.
   */
  const findFloorDetailsByLocationText = useCallback(async (locationText) => {
    const match = await findAssetsListDocByLocationText(locationText);
    if (!match) return null;
    return extractFloorDetailsFromAsset(match.data, match.id);
  }, []);

  const waitWhileMonitorPaused = useCallback(async () => {
    while (isMonitorLoopPaused() && isMonitorLoopActive()) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }, []);

  /** Sleep between cycles, but wake early when Asset Control pauses monitoring. */
  const sleepMonitorInterval = useCallback(async () => {
    const started = Date.now();
    while (Date.now() - started < MONITOR_INTERVAL_MS) {
      if (!isMonitorLoopActive() || isMonitorLoopPaused()) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }, []);

  const runFirePanelMonitorLoop = useCallback(async () => {
    while (isMonitorLoopActive()) {
      await waitWhileMonitorPaused();
      if (!isMonitorLoopActive()) break;

      setMonitorCycleRunning(true);
      let cycleYielded = false;

      try {
      const cycleBaseline = {
        totalFire: firePanelStateRef.current?.totalFire ?? 0,
        totalSupervisory: firePanelStateRef.current?.totalSupervisory ?? 0,
        totalTrouble: firePanelStateRef.current?.totalTrouble ?? 0,
      };

      const counts = {
        totalFire: cycleBaseline.totalFire,
        totalSupervisory: cycleBaseline.totalSupervisory,
        totalTrouble: cycleBaseline.totalTrouble,
      };

      let allCvalsParsed = true;
      let fireAlertTriggeredThisCycle = false;

      for (const { label, cmd, field } of CVAL_COMMANDS) {
        if (!isMonitorLoopActive()) break;
        if (isMonitorLoopPaused()) {
          cycleYielded = true;
          break;
        }
        appendFirePanelMonitorLog(`>> ${label}: ${cmd}`);
        const previousCounts = { ...counts };
        try {
          let response = await sendFirePanelCommand(cmd);
          let parsed = extractCVal(response, cmd);

          // One quick retry when the panel returns a partial/garbled chunk
          if (!parsed || !Number.isFinite(parsed.cval)) {
            if (isMonitorLoopPaused()) {
              cycleYielded = true;
              break;
            }
            await new Promise((r) => setTimeout(r, 250));
            if (isMonitorLoopPaused()) {
              cycleYielded = true;
              break;
            }
            response = await sendFirePanelCommand(cmd);
            parsed = extractCVal(response, cmd);
          }

          const cval = parsed?.cval;

          if (!Number.isFinite(cval)) {
            allCvalsParsed = false;
            counts[field] = previousCounts[field];
            appendFirePanelMonitorLog(
              `!! ${label}: CVAL not parsed — keeping ${counts[field]} (${response.trim() || "(empty)"})`,
            );
          } else {
            counts[field] = cval;
            syncFirePanelFieldToUi(field, cval);
            appendFirePanelMonitorLog(
              `<< ${response.trim() || "(empty)"} (CVAL=${counts[field]})`,
            );

            if (
              field === "totalFire" &&
              cval > cycleBaseline.totalFire &&
              cval > 0
            ) {
              showFireAlert();
              unmuteSiren();
              fireAlertTriggeredThisCycle = true;
              // Yield immediately to the browser event loop so React renders the Red "Fire Ack" button
              // and opens the Fire Alert Modal on screen within 1ms before any background list commands run!
              await new Promise((resolve) => setTimeout(resolve, 0));
            }
          }
        } catch (error) {
          allCvalsParsed = false;
          counts[field] = previousCounts[field] ?? 0;
          appendFirePanelMonitorLog(
            `!! ${label}: ${error.message} — keeping ${counts[field]}`,
          );
          if (/deferred for priority command/i.test(error.message || "")) {
            appendFirePanelMonitorLog(`>> ${cmd} deferred for priority ACK command — yielding cycle`);
            cycleYielded = true;
            break;
          }
          if (/not connected/i.test(error.message || "")) {
            appendFirePanelMonitorLog("!! Not connected — refreshing session status...");
            useFirePanelStore.getState().markDisconnected(error.message);
            await useFirePanelStore.getState().syncStatus();
            if (!useFirePanelStore.getState().connected) {
              appendFirePanelMonitorLog("!! Attempting telnet reconnect...");
              try {
                await useFirePanelStore.getState().ensureConnected();
              } catch (reconnectError) {
                appendFirePanelMonitorLog(
                  `!! Reconnect failed: ${reconnectError?.message || reconnectError}`,
                );
              }
            }
            if (!useFirePanelStore.getState().connected || !isMonitorLoopActive()) {
              // Break the cycle — do not return (that kills the loop permanently).
              cycleYielded = true;
              break;
            }
          }
        }
      }

      if (cycleYielded || isMonitorLoopPaused()) {
        if (!useFirePanelStore.getState().connected) {
          appendFirePanelMonitorLog("!! Monitor loop waiting — panel disconnected");
        }
        // Skip interval sleep so Asset Control `show` can run immediately.
        continue;
      }

      if (!isMonitorLoopActive()) break;

      if (!allCvalsParsed) {
        appendFirePanelMonitorLog(
          "CVAL partially parsed — saving best-known totals",
        );
      }

      const previous = cycleBaseline;

      const incrementedValues = CVAL_COMMANDS.filter(
        ({ field }) => counts[field] > previous[field],
      );
      const changedValues = CVAL_COMMANDS.filter(
        ({ field }) => counts[field] !== previous[field],
      );

      incrementedValues.forEach((value) => {
        const isIncrease =
          counts[value.field] > 0 && previous[value.field] < counts[value.field];

        if (value.label === "Fire" && isIncrease && !fireAlertTriggeredThisCycle) {
          showFireAlert();
          unmuteSiren();
        }
      });

      const fireIncreasedThisCycle = incrementedValues.some(
        (value) =>
          value.label === "Fire" &&
          counts[value.field] > 0 &&
          previous[value.field] < counts[value.field],
      );

      if (!fireIncreasedThisCycle) {
        incrementedValues.forEach((value) => {
          const isIncrease =
            counts[value.field] > 0 && previous[value.field] < counts[value.field];

          if (value.label === "Trouble" && isIncrease) {
            showTroubleAlert();
          }
          if (value.label === "Supervisory" && isIncrease) {
            showSupervisoryAlert();
          }
        });
      }

      void saveFirePanelState(counts).then((saved) => {
        if (!saved) return;
        if (saved.unchanged) {
          appendFirePanelMonitorLog("DB firePanelState unchanged — skip write");
        } else {
          appendFirePanelMonitorLog(
            `DB firePanelState → fire=${saved.totalFire} supervisory=${saved.totalSupervisory} trouble=${saved.totalTrouble}`,
          );
        }
      }).catch((error) => {
        appendFirePanelMonitorLog(`!! save failed: ${error.message}`);
      });

      // When category counts change (e.g. totalTrouble changed from previous value):
      // Run list command, update device statuses, diff with temp array fast in milliseconds,
      // and reset excluded devices to 0.
      if (changedValues.length > 0) {
        appendFirePanelMonitorLog("--- count change detected — syncing device list ---");
        // Yield to browser event loop so React paints updated UI counts & alert modals first
        await new Promise((resolve) => setTimeout(resolve, 0));
        for (const { label, listCmd, field } of changedValues) {
          if (!isMonitorLoopActive() || isMonitorLoopPaused()) {
            cycleYielded = true;
            break;
          }

          const currentCount = counts[field];
          const prevCount = previous[field];
          const statusKey = simplexKeyForCategoryLabel(label);
          const prevAddresses = previousListAddressesRef.current[label] || [];

          appendFirePanelMonitorLog(
            `>> ${label} count changed (${prevCount}→${currentCount}) — ${listCmd}`,
          );

          if (currentCount === 0) {
            // Count reached 0: reset status flag to 0 for all previous addresses fast in milliseconds
            useAssetFireStatusStore
              .getState()
              .syncPanelLiveFlagsForCategory(statusKey, [], prevAddresses);

            previousListAddressesRef.current[label] = [];
            storeFirePanelListResponse(label, listCmd, "", {
              markNewest: false,
              expectedCount: 0,
            });

            void (async () => {
              try {
                const { clearedCount } = await syncAssetsListWithPanelList(label, []);
                if (clearedCount > 0) {
                  appendFirePanelMonitorLog(
                    `AssetsList cleared ${label} (${statusKey}=0): ${clearedCount}`,
                  );
                  useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
                }
              } catch (error) {
                appendFirePanelMonitorLog(`!! ${listCmd} clear sync failed: ${error.message}`);
              }
            })();
          } else {
            // Count changed (>0): run list command and perform fast diff update
            try {
              const isIncrement = currentCount > prevCount;
              const streamPatchedAddresses = new Set();

              let listResponse = await sendFirePanelListCommandAndWait(listCmd, label, {
                markNewest: isIncrement,
                expectedCount: currentCount,
                onPartial: (partial) => {
                  const deviceAddresses = extractPanelDeviceAddresses(partial);
                  const freshAddresses = deviceAddresses.filter(
                    (address) => !streamPatchedAddresses.has(address),
                  );
                  if (freshAddresses.length === 0) return;
                  freshAddresses.forEach((address) =>
                    streamPatchedAddresses.add(address),
                  );
                  useAssetFireStatusStore
                    .getState()
                    .syncPanelLiveFlagsForCategory(statusKey, deviceAddresses, prevAddresses);
                },
              });

              const deviceAddresses = extractPanelDeviceAddresses(listResponse);

              // Fast in-memory diff update (milliseconds):
              // active addresses set to 1, excluded addresses reset to 0
              useAssetFireStatusStore
                .getState()
                .syncPanelLiveFlagsForCategory(statusKey, deviceAddresses, prevAddresses);

              // Save to temp array for next comparison
              previousListAddressesRef.current[label] = deviceAddresses;

              void (async () => {
                try {
                  const { updatedCount, clearedCount } = await syncAssetsListWithPanelList(
                    label,
                    deviceAddresses,
                  );

                  if (updatedCount > 0 || clearedCount > 0) {
                    appendFirePanelMonitorLog(
                      `AssetsList synced ${label} → ${statusKey}=1: ${updatedCount}, cleared: ${clearedCount}`,
                    );
                    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
                  } else {
                    appendFirePanelMonitorLog(
                      `Panel live ${statusKey} flags synced for ${deviceAddresses.length} address(es)`,
                    );
                  }
                } catch (error) {
                  appendFirePanelMonitorLog(`!! ${listCmd} background sync: ${error.message}`);
                  console.error(`[fire-panel monitor] ${listCmd} background sync failed:`, error);
                }
              })();
            } catch (error) {
              appendFirePanelMonitorLog(`!! ${listCmd} failed: ${error.message}`);
              console.error(`[fire-panel monitor] ${listCmd} failed:`, error);
            }
          }
        }
      }

      // Re-apply live monitor F/T to markers every CVAL cycle (not only on increase).
      if (!cycleYielded && !isMonitorLoopPaused()) {
        for (const { label, listCmd, field } of CVAL_COMMANDS) {
          const statusKey = simplexKeyForCategoryLabel(label);
          const count = counts[field];

          if (count === 0) {
            listBootstrappedRef.current[label] = false;
            continue;
          }

          const knownAddresses = previousListAddressesRef.current[label] || [];
          if (knownAddresses.length > 0) {
            useAssetFireStatusStore
              .getState()
              .syncPanelLiveFlagsForCategory(statusKey, knownAddresses);
            continue;
          }

          if (listBootstrappedRef.current[label]) continue;

          listBootstrappedRef.current[label] = true;
          appendFirePanelMonitorLog(
            `>> ${label} CVAL=${count} — bootstrap ${listCmd} for marker colors`,
          );
          try {
            const listResponse = await sendFirePanelListCommandAndWait(listCmd, label, {
              markNewest: false,
              expectedCount: count,
            });
            const deviceAddresses = extractPanelDeviceAddresses(listResponse);
            useAssetFireStatusStore
              .getState()
              .syncPanelLiveFlagsForCategory(statusKey, deviceAddresses);
            storeFirePanelListResponse(label, listCmd, listResponse, {
              markNewest: false,
              expectedCount: count,
            });
          } catch (error) {
            listBootstrappedRef.current[label] = false;
            appendFirePanelMonitorLog(
              `!! bootstrap ${listCmd} failed: ${error.message}`,
            );
          }
        }
      }

      } finally {
        setMonitorCycleRunning(false);
      }

      await sleepMonitorInterval();
    }
  }, [
    appendFirePanelMonitorLog,
    saveFirePanelState,
    sendFirePanelCommand,
    sendFirePanelListCommandAndWait,
    showFireAlert,
    showTroubleAlert,
    showSupervisoryAlert,
    sleepMonitorInterval,
    storeFirePanelListResponse,
    waitWhileMonitorPaused,
    syncFirePanelFieldToUi,
  ]);

  const startFirePanelMonitoring = useCallback(async () => {
    await useFirePanelStore.getState().syncStatus();

    if (!useFirePanelStore.getState().connected) {
      setFirePanelMonitoringPersisted(false);
      setFirePanelMonitoring(false);
      return { ok: false, reason: "not_connected" };
    }

    setFirePanelMonitoringPersisted(true);
    setFirePanelMonitoring(true);

    if (isMonitorLoopActive()) {
      return { ok: true, alreadyRunning: true };
    }
    setMonitorLoopActive(true);
    useAssetFireStatusStore.getState().startPolling();
    appendFirePanelMonitorLog("--- started ---");
    void runFirePanelMonitorLoop();
    return { ok: true };
  }, [appendFirePanelMonitorLog, runFirePanelMonitorLoop]);

  const toggleFirePanelMonitoring = useCallback(() => {
    if (isMonitorLoopActive() || isFirePanelMonitoringPersisted()) {
      stopFirePanelMonitoring();
      return { ok: true, action: "stopped" };
    }
    return startFirePanelMonitoring();
  }, [startFirePanelMonitoring, stopFirePanelMonitoring]);

  const fetchFirePanelState = useCallback(async () => {
    try {
      const res = await apiFetch("/api/telnet/fire-panel/panel-state");
      if (!res.ok) return;
      const data = await parseApiJsonResponse(res);
      // Live monitor loop owns CVAL display — avoid stale DB reads overwriting polled values
      if (isMonitorLoopActive()) return;
      setFirePanelState(data);
      firePanelStateRef.current = data;
    } catch {
      // API may be unavailable on first load
    } finally {
      setFirePanelStateLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchFirePanelState();
    const timer = setInterval(fetchFirePanelState, PANEL_STATE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [fetchFirePanelState]);

  // Keep monitoring badge in sync after reload when session still expects monitoring
  useEffect(() => {
    if (isMonitorLoopActive() || isFirePanelMonitoringPersisted()) {
      setFirePanelMonitoring(true);
    }
  }, []);

  // Listen for single/live fire, trouble, supervisory events (not list command dumps)
  // and dynamically update firePanelListResponses state
  useEffect(() => {
    if (typeof window === "undefined") return;

    const handleCategoryListUpdated = (e) => {
      const detail = e.detail;
      if (!detail || !detail.label || !detail.row) return;
      const { label, row } = detail;

      setFirePanelListResponses((prev) => {
        const existing = prev[label] || {};
        const existingRows = Array.isArray(existing.rows) ? existing.rows : [];
        const addr = row.fullAddress || row.deviceAddress || "";
        const filtered = existingRows.filter((r) =>
          addr ? r.fullAddress !== addr : r.raw !== row.raw,
        );
        const nextRows = [row, ...filtered];

        return {
          ...prev,
          [label]: {
            ...existing,
            rows: nextRows,
            fetchedAt: row.timestamp || new Date().toISOString(),
            newestAddress: addr || existing.newestAddress || "",
          },
        };
      });
    };

    window.addEventListener("vision365:categoryListUpdated", handleCategoryListUpdated);
    return () => {
      window.removeEventListener("vision365:categoryListUpdated", handleCategoryListUpdated);
    };
  }, []);

  // Resume monitoring after reload/navigation when panel is still connected
  useEffect(() => {
    void useFirePanelStore.getState().syncStatus();
  }, []);

  // useEffect(() => {
  //   if (activeDevices.length == 0) {
  //     hideFireAlert();
  //   } 
  // }, [activeDevices.length]);

  // NOTE: CVAL polling ("cshow a0/a1/a2 cval") no longer auto-starts on connect.
  // It previously fired here on every connect, hammering the panel with a
  // command every ~500ms indefinitely. Live fire/trouble/supervisory updates
  // are already handled by the SSE stream in FireModalContext, so monitoring
  // is now opt-in only via the "Monitor Data" toggle on the Network page.
  useEffect(() => {
    if (firePanelConnected) {
      firePanelWasConnectedRef.current = true;
    }
  }, [firePanelConnected]);

  // Sync session from local storage
  useEffect(() => {
    const session = getStoredSessionUser();
    const email = String(session?.email || localStorage.getItem("userEmail") || "").trim();

    if (!email) {
      setIsAuthenticated(false);
      setIsLoading(false);
      setIsInitialized(true);
      return;
    }

    const role = session?.role || localStorage.getItem("userRole") || "admin";
    setUserEmail(email);
    setUserRole(role);
    setEffectiveFetchRole("admin");
    setUser(session || { email, role });
    setIsAuthenticated(true);
  }, [pathname]);

  // Load data when authenticated
  useEffect(() => {
    if (!isAuthenticated || !userEmail || isInitialized) return;

    async function loadAll() {
      setIsLoading(true);
      try {
        await Promise.all([loadCommunities(), loadAssets(), loadBrands(), loadStaff(), loadJobs()]);
      } catch (err) {
        setError({ global: err.message });
      } finally {
        setIsLoading(false);
        setIsInitialized(true);
      }
    }

    loadAll();
  }, [isAuthenticated, userEmail, isInitialized]);

  

  useEffect(() => {
    const names = new Set();
    communities.forEach((c) => {
      (c.buildings || []).forEach((b) => {
        const n = normalizeBuildingName(b);
        if (n) names.add(n);
      });
    });
    setAllBuildings([...names].map((name) => ({ name })));
  }, [communities]);

  async function loadCommunities() {
    setLoadingStates((s) => ({ ...s, communities: true }));
    try {
      const res = await getUserCommunities(userEmail, "admin");
      setCommunities(res.communities || []);
    } catch (err) {
      setError((e) => ({ ...e, communities: err.message }));
    } finally {
      setLoadingStates((s) => ({ ...s, communities: false }));
    }
  }

  async function loadAssets() {
    setLoadingStates((s) => ({ ...s, assets: true }));
    try {
      const snap = await mockGetDocs(mockCollection(db, "AssetsList"));
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, name: d.data().description || d.id, ...d.data() }));
      setGlobalAssets(list);
    } finally {
      setLoadingStates((s) => ({ ...s, assets: false }));
    }
  }

  async function loadBrands() {
    setLoadingStates((s) => ({ ...s, brands: true }));
    try {
      setBrandRegistry(await loadBrandRegistry(db, mockGetDocs, mockCollection));
    } finally {
      setLoadingStates((s) => ({ ...s, brands: false }));
    }
  }

  async function loadStaff() {
    setLoadingStates((s) => ({ ...s, staff: true }));
    try {
      const snap = await mockGetDocs(mockCollection(db, "Staffs"));
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setStaffList(list);
    } finally {
      setLoadingStates((s) => ({ ...s, staff: false }));
    }
  }

  async function loadJobs() {
    setLoadingStates((s) => ({ ...s, jobs: true }));
    try {
      const snap = await mockGetDocs(mockCollection(db, "jobs"));
      const list = [];
      snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
      setJobs(list);
    } finally {
      setLoadingStates((s) => ({ ...s, jobs: false }));
    }
  }

  async function login(email, role, sessionUser) {
    secureLocalStorage.setItem("user", sessionUser);
    localStorage.setItem("userEmail", email);
    localStorage.setItem("userRole", role);
    setUserEmail(email);
    setUserRole(role);
    setEffectiveFetchRole("admin");
    setUser(sessionUser);
    setIsAuthenticated(true);
    setIsInitialized(false);
    setIsLoading(true);
  }

  function logout() {
    secureLocalStorage.removeItem("user");
    localStorage.removeItem("userEmail");
    localStorage.removeItem("userRole");
    setUser(null);
    setUserEmail(null);
    setUserRole(null);
    setIsAuthenticated(false);
    setCommunities([]);
    setGlobalAssets([]);
    setIsInitialized(false);
  }

  const getScopedCommunities = useCallback(() => communities, [communities]);

  const getAssignedBuildings = useCallback(
    () => allBuildings.map((b) => b.name),
    [allBuildings],
  );

  const refreshGlobalData = useCallback(() => {
    setIsInitialized(false);
    setIsLoading(true);
  }, []);

  const refetchCommunities = useCallback(async () => {
    await loadCommunities();
  }, [loadCommunities]);

  const value = useMemo(
    () => ({
      user,
      userRole,
      userEmail,
      effectiveFetchRole,
      isAuthenticated,
      communities,
      globalAssets,
      brandRegistry,
      staffList,
      jobs,
      allBuildings,
      selectedCommunity,
      selectedBuilding,
      buildingCache,
      setSelectedCommunity,
      setSelectedBuilding,
      setBuildingCache,
      isLoading,
      isInitialized,
      error,
      loadingStates,
      login,
      logout,
      getScopedCommunities,
      getAssignedBuildings,
      refreshGlobalData,
      refetch: refreshGlobalData,
      refetchCommunities,
      // Fire panel monitor (global — survives route changes)
      firePanelMonitoring,
      firePanelMonitorLogs,
      firePanelState,
      firePanelStateLoading,
      startFirePanelMonitoring,
      stopFirePanelMonitoring,
      toggleFirePanelMonitoring,
      fetchFirePanelState,
      systemReset,
      silenceAlarm,
      acknowledge,
      firePanelListResponses,
      fetchFirePanelListResponse,
      // Global fire alert modal
      isFireAlertOpen,
      openFireAlertModal,
      closeFireAlertModal,
      disableDevice,
      enableDevice,
      findDeviceAddressByLocationText,
      findFloorDetailsByLocationText,
      activeDevices,
      setActiveDevices,
    }),
    [
      user,
      userRole,
      userEmail,
      effectiveFetchRole,
      isAuthenticated,
      communities,
      globalAssets,
      brandRegistry,
      staffList,
      jobs,
      allBuildings,
      selectedCommunity,
      selectedBuilding,
      buildingCache,
      isLoading,
      isInitialized,
      error,
      loadingStates,
      getScopedCommunities,
      getAssignedBuildings,
      refreshGlobalData,
      refetchCommunities,
      firePanelMonitoring,
      firePanelMonitorLogs,
      firePanelState,
      firePanelStateLoading,
      startFirePanelMonitoring,
      stopFirePanelMonitoring,
      toggleFirePanelMonitoring,
      fetchFirePanelState,
      systemReset,
      silenceAlarm,
      acknowledge,
      firePanelListResponses,
      fetchFirePanelListResponse,
      isFireAlertOpen,
      openFireAlertModal,
      closeFireAlertModal,
      disableDevice,
      enableDevice,
      findDeviceAddressByLocationText,
      findFloorDetailsByLocationText,
      activeDevices,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      <LivePanelAlertWatcher />
      {children}
      <FireAlertModal open={isFireAlertOpen} onClose={closeFireAlertModal} />
    </AppContext.Provider>
  );
};
