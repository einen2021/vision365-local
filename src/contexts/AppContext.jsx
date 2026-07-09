"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import { apiFetch } from "@/lib/apiClient";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { findAssetsListEntryByPanelAddress } from "@/lib/assetsListSimplexStatus";
import { resolveAssetDeviceAddress, parseSimplexAddressToken } from "@/lib/simplexDeviceAddress";
import { db } from "@/config/firebase";
import {
  CVAL_COMMANDS,
  MONITOR_INTERVAL_MS,
  PANEL_STATE_REFRESH_MS,
  LIST_COMMAND_TIMEOUT_MS,
  extractCVal,
  extractPanelDeviceAddresses,
  isListResponseComplete,
  readSimplexStatus,
  simplexKeyForCategoryLabel,
} from "@/lib/firePanelMonitor";
import {
  appendBuildingAlarmFeed,
  resolveBuildingFromAsset,
} from "@/lib/buildingAlarmFeedWrite";
import {
  isFirePanelMonitoringPersisted,
  isMonitorLoopActive,
  isMonitorLoopPaused,
  pauseMonitorLoop,
  resumeMonitorLoop,
  setFirePanelMonitoringPersisted,
  setMonitorLoopActive,
} from "@/lib/firePanelMonitorSession";
import { useFireAlert } from "./FireModalContext";

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
    disableDevice,
    enableDevice,
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
    disableDevice,
    enableDevice,
  };
};

export const AppProvider = ({ children }) => {
  const pathname = usePathname();

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

  const { showFireAlert, setAddressLoading, setDeviceList,muteSiren, unmuteSiren } = useFireAlert();

  // Global fire-panel CVAL monitor (persists across routes and reloads)
  const [firePanelMonitoring, setFirePanelMonitoring] = useState(
    () => isFirePanelMonitoringPersisted(),
  );
  const [firePanelMonitorLogs, setFirePanelMonitorLogs] = useState([]);
  const [firePanelState, setFirePanelState] = useState(null);
  const [firePanelStateLoading, setFirePanelStateLoading] = useState(true);
  const firePanelStateRef = useRef(null);
  const firePanelWasConnectedRef = useRef(false);
  const pendingMonitorLogsRef = useRef([]);
  const monitorLogFlushTimerRef = useRef(null);

  /** Push polled CVAL totals into React state immediately (header badges). */
  const syncFirePanelCountsToUi = useCallback((counts) => {
    const next = {
      totalFire: Number(counts.totalFire) || 0,
      totalSupervisory: Number(counts.totalSupervisory) || 0,
      totalTrouble: Number(counts.totalTrouble) || 0,
      lastPanelSync: firePanelStateRef.current?.lastPanelSync ?? null,
    };
    const prev = firePanelStateRef.current;
    if (
      prev &&
      prev.totalFire === next.totalFire &&
      prev.totalSupervisory === next.totalSupervisory &&
      prev.totalTrouble === next.totalTrouble
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
      const data = await res.json();
      if (!res.ok) {
        const message = data.error || "Command failed";
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
        const connected = await useFirePanelStore.getState().ensureConnected();
        if (connected) return await runOnce();
      }
      throw error;
    }
  }, []);

  const acknowledge = useCallback(async (label) => {
    let cmd;
    switch (label) {
      case "Fire":
        cmd = "ack f";
        break;
      case "Trouble":
        cmd = "ack t";
        break;
      case "Supervisory":
        cmd = "ack s";
        break;
      default:
        throw new Error(`Unknown acknowledge type: ${label}`);
    }

    const response = await sendFirePanelCommand(cmd);
    console.log({ response });
    return response;
  }, [sendFirePanelCommand]);

  const sendFirePanelListCommandAndWait = useCallback(
    async (listCmd) => {
      appendFirePanelMonitorLog(`>> ${listCmd} (waiting for response...)`);
      const response = await sendFirePanelCommand(listCmd, LIST_COMMAND_TIMEOUT_MS);
      if (!isListResponseComplete(response)) {
        appendFirePanelMonitorLog(`!! ${listCmd}: response incomplete (no _DNE)`);
      } else {
        appendFirePanelMonitorLog(`<< ${listCmd} complete (${response.length} chars)`);
      }
      return response;
    },
    [appendFirePanelMonitorLog, sendFirePanelCommand],
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
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to save panel state");

    const nextState = {
      totalFire: Number(data.totalFire ?? payload.totalFire) || 0,
      totalSupervisory: Number(data.totalSupervisory ?? payload.totalSupervisory) || 0,
      totalTrouble: Number(data.totalTrouble ?? payload.totalTrouble) || 0,
      lastPanelSync:
        typeof data.lastPanelSync === "string"
          ? data.lastPanelSync
          : firePanelStateRef.current?.lastPanelSync ?? null,
    };
    firePanelStateRef.current = nextState;
    setFirePanelState(nextState);
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
    const loginResponse = await sendFirePanelCommand("login 444");
    if (!loginResponse.includes("ACCESS GRANTED")) {
      throw new Error("Panel login failed");
    }
    return sendFirePanelListCommandAndWait("set p217 on");
  }, []);

  const systemReset = useCallback(async () => {

    const loginResponse = await sendFirePanelCommand('login 444');
    console.log({ loginResponse})
    if(loginResponse.includes("ACCESS GRANTED")){
      const reset = await sendFirePanelListCommandAndWait("set p212 on")
      console.log({ reset })
      console.log("[RESETTING]: sending command")
    }
    const snapshot = await getDocs(collection(db, "AssetsList"));

    snapshot.docs.map(async(docSnap) => {
      const data = docSnap.data();
      // console.log({ data })
      const current = readSimplexStatus(data);
      if(current.F !== 1 && !data.building && data.building !== "") {
        console.log("[RESETING]: Skipping.. address: ",data.deviceAddress)
        return
      };
      const next = { ...current, F: 0 };
      await updateDoc(doc(db, "AssetsList", data.deviceAddress), {
        simplexStatus: next,
        updatedAt: new Date().toISOString(),
      });
      useAssetFireStatusStore.getState().patchSimplexStatus(
        data.deviceAddress,
        resolveAssetDeviceAddress(data) || data.deviceAddress || "",
        next,
      );

    })

    useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
  }, []);


  const disableDevice = async(deviceAddress) => {
    const disableResponse = await sendFirePanelCommand(`disable ${deviceAddress} on`);
    console.log({ disableResponse })
  }

  const enableDevice = async(deviceAddress) => {
    const enableResponse = await sendFirePanelCommand(`disable ${deviceAddress} off`);
    console.log({ enableResponse })
  }

  const waitWhileMonitorPaused = useCallback(async () => {
    while (isMonitorLoopPaused() && isMonitorLoopActive()) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }, []);

  const runFirePanelMonitorLoop = useCallback(async () => {
    while (isMonitorLoopActive()) {
      await waitWhileMonitorPaused();
      if (!isMonitorLoopActive()) break;

      const counts = {
        totalFire: 0,
        totalSupervisory: 0,
        totalTrouble: 0,
      };

      let allCvalsParsed = true;

      for (const { label, cmd, field } of CVAL_COMMANDS) {
        if (!isMonitorLoopActive()) break;
        appendFirePanelMonitorLog(`>> ${label}: ${cmd}`);
        const previousCounts = firePanelStateRef.current ?? {
          totalFire: 0,
          totalSupervisory: 0,
          totalTrouble: 0,
        };
        try {
          let response = await sendFirePanelCommand(cmd);
          let parsed = extractCVal(response, cmd);

          // One quick retry when the panel returns a partial/garbled chunk
          if (!parsed || !Number.isFinite(parsed.cval)) {
            await new Promise((r) => setTimeout(r, 250));
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
            appendFirePanelMonitorLog(
              `<< ${response.trim() || "(empty)"} (CVAL=${counts[field]})`,
            );
          }
        } catch (error) {
          allCvalsParsed = false;
          counts[field] = previousCounts[field] ?? 0;
          appendFirePanelMonitorLog(
            `!! ${label}: ${error.message} — keeping ${counts[field]}`,
          );
          console.error(`[fire-panel monitor] ${cmd} failed:`, error);
          if (/not connected/i.test(error.message || "")) {
            appendFirePanelMonitorLog("!! Not connected — reconnecting...");
            const connected = await useFirePanelStore.getState().ensureConnected();
            if (!connected || !isMonitorLoopActive()) {
              return;
            }
          }
        }
      }

      if (!isMonitorLoopActive()) break;

      if (!allCvalsParsed) {
        appendFirePanelMonitorLog(
          "CVAL partially parsed — updating UI and saving best-known totals",
        );
      }

      const previous = firePanelStateRef.current ?? {
        totalFire: 0,
        totalSupervisory: 0,
        totalTrouble: 0,
      };

      // Header badges read firePanelState — sync immediately after each poll cycle
      syncFirePanelCountsToUi(counts);

      const incrementedValues = CVAL_COMMANDS.filter(
        ({ field }) => counts[field] > previous[field],
      );

    // show fire alert if fire alarm is triggered
    incrementedValues.forEach(async (value) => {
      if(value.label === "Fire" && counts[value.field] > 0 && previous[value.field] < counts[value.field]) {
        showFireAlert();
        unmuteSiren();
      }
    });
      


      try {
        const saved = await saveFirePanelState(counts);
        if (saved.unchanged) {
          appendFirePanelMonitorLog("DB firePanelState unchanged — skip write");
        } else {
          appendFirePanelMonitorLog(
            `DB firePanelState → fire=${saved.totalFire} supervisory=${saved.totalSupervisory} trouble=${saved.totalTrouble}`,
          );
        }
      } catch (error) {
        appendFirePanelMonitorLog(`!! save failed: ${error.message}`);
      }

      if (incrementedValues.length > 0) {
        pauseMonitorLoop();
        appendFirePanelMonitorLog("--- paused for asset sync ---");
        try {
          for (const { label, listCmd, field } of incrementedValues) {
            if (!isMonitorLoopActive()) break;
            appendFirePanelMonitorLog(`>> ${label} changed — ${listCmd}`);
            try {
              setAddressLoading(true);
              const listResponse = await sendFirePanelListCommandAndWait(listCmd);
              const deviceAddresses = extractPanelDeviceAddresses(listResponse);
              const statusKey = simplexKeyForCategoryLabel(label);
              const fallbackBuildings = allBuildings.map((b) => b.name);
              let updatedCount = 0;
              let alarmFeedCount = 0;

              if (deviceAddresses.length === 0) {
                appendFirePanelMonitorLog(
                  `!! ${listCmd}: no device addresses parsed from panel list`,
                );
                const loneBuilding = resolveBuildingFromAsset({}, fallbackBuildings);
                if (loneBuilding) {
                  await appendBuildingAlarmFeed({
                    building: loneBuilding,
                    label,
                    description: `${label} alarm (${counts[field]} active)`,
                  });
                  alarmFeedCount += 1;
                }
              }

              for (const deviceAddress of deviceAddresses) {
                const entry = await findAssetsListEntryByPanelAddress(deviceAddress);
                const data = entry ? { ...entry.data, id: entry.id } : null;
                const building = resolveBuildingFromAsset(data, fallbackBuildings);
                const description =
                  data?.description || data?.name || deviceAddress;

                if (building) {
                  await appendBuildingAlarmFeed({
                    building,
                    label,
                    description,
                  });
                  alarmFeedCount += 1;
                } else {
                  appendFirePanelMonitorLog(
                    `!! ${deviceAddress}: no building — skipped alarm feed`,
                  );
                }

                if (!entry) {
                  appendFirePanelMonitorLog(
                    `!! ${deviceAddress}: not found in AssetsList`,
                  );
                  continue;
                }

                if (data) {
                  setDeviceList((prev) => [...prev, data]);
                }

                const current = readSimplexStatus(data);
                if (Number(current[statusKey]) === 1) continue;

                const next = { ...current, [statusKey]: 1 };
                await updateDoc(doc(db, "AssetsList", entry.id), {
                  simplexStatus: next,
                  updatedAt: new Date().toISOString(),
                });

                useAssetFireStatusStore.getState().patchSimplexStatus(
                  entry.id,
                  resolveAssetDeviceAddress(data) || data.deviceAddress || deviceAddress,
                  next,
                );
                updatedCount += 1;
              }
              setAddressLoading(false);

              if (alarmFeedCount > 0) {
                appendFirePanelMonitorLog(
                  `Alarm feed updated ${alarmFeedCount} row(s) (${label})`,
                );
              }

              if (updatedCount > 0) {
                appendFirePanelMonitorLog(
                  `AssetsList updated ${updatedCount} asset(s) → ${statusKey}=1 (${label})`,
                );
                useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
              }
            } catch (error) {
              appendFirePanelMonitorLog(`!! ${listCmd} failed: ${error.message}`);
              console.error(`[fire-panel monitor] ${listCmd} failed:`, error);
              setAddressLoading(false);
            }
          }
        } finally {
          resumeMonitorLoop();
          appendFirePanelMonitorLog("--- monitoring resumed ---");
        }
      }

      await new Promise((r) => setTimeout(r, MONITOR_INTERVAL_MS));
    }
  }, [
    allBuildings,
    appendFirePanelMonitorLog,
    saveFirePanelState,
    sendFirePanelCommand,
    sendFirePanelListCommandAndWait,
    showFireAlert,
    waitWhileMonitorPaused,
    syncFirePanelCountsToUi,
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
      const data = await res.json();
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

  // Resume monitoring after reload/navigation when panel is still connected
  useEffect(() => {
    void useFirePanelStore.getState().syncStatus();
  }, []);

  // useEffect(() => {
  //   if (activeDevices.length == 0) {
  //     hideFireAlert();
  //   } 
  // }, [activeDevices.length]);

  useEffect(() => {
    if (firePanelConnected) {
      firePanelWasConnectedRef.current = true;
      if (!isMonitorLoopActive()) {
        void startFirePanelMonitoring();
      } else {
        setFirePanelMonitoring(true);
      }
    }
  }, [firePanelConnected, startFirePanelMonitoring]);

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

  function getScopedCommunities() {
    return communities;
  }

  function getAssignedBuildings() {
    return allBuildings.map((b) => b.name);
  }

  async function refreshGlobalData() {
    setIsInitialized(false);
    setIsLoading(true);
  }

  async function refetchCommunities() {
    await loadCommunities();
  }

  const value = {
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
    // Global fire alert modal
    isFireAlertOpen,
    openFireAlertModal,
    closeFireAlertModal,
    disableDevice,
    enableDevice,
    activeDevices,
    setActiveDevices,
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <FireAlertModal open={isFireAlertOpen} onClose={closeFireAlertModal} />
    </AppContext.Provider>
  );
};
