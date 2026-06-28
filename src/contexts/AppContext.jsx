"use client";

/**
 * Simplified AppContext for admin-only JSON-backed app.
 * All data is loaded from data/db.json via mock Firestore.
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
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
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";
import { db } from "@/config/firebase";
import {
  CVAL_COMMANDS,
  MONITOR_INTERVAL_MS,
  PANEL_STATE_REFRESH_MS,
  LIST_COMMAND_TIMEOUT_MS,
  extractCVal,
  isListResponseComplete,
  readSimplexStatus,
  simplexKeyForCategoryLabel,
} from "@/lib/firePanelMonitor";
import {
  isFirePanelMonitoringPersisted,
  isMonitorLoopActive,
  isMonitorLoopPaused,
  pauseMonitorLoop,
  resumeMonitorLoop,
  setFirePanelMonitoringPersisted,
  setMonitorLoopActive,
} from "@/lib/firePanelMonitorSession";

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
    acknowledge
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
    acknowledge
  };
};

export const AppProvider = ({ children }) => {
  const pathname = usePathname();

  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [effectiveFetchRole, setEffectiveFetchRole] = useState("admin");
  const [userEmail, setUserEmail] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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
    const res = await apiFetch("/api/telnet/fire-panel/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: cmd, timeoutMs }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Command failed");
    return data.response || "";
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
    if (!data.unchanged) {
      setFirePanelState(data);
      firePanelStateRef.current = data;
    }
    return data;
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
          const response = await sendFirePanelCommand(cmd);
          const parsed = extractCVal(response);
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
        }
      }

      if (!isMonitorLoopActive()) break;

      if (!allCvalsParsed) {
        appendFirePanelMonitorLog("CVAL incomplete — skip save this cycle");
        await new Promise((r) => setTimeout(r, MONITOR_INTERVAL_MS));
        continue;
      }

      const previous = firePanelStateRef.current ?? {
        totalFire: 0,
        totalSupervisory: 0,
        totalTrouble: 0,
      };
      const incrementedValues = CVAL_COMMANDS.filter(
        ({ field }) => counts[field] > previous[field],
      );

      try {
        const saved = await saveFirePanelState(counts);
        if (saved.unchanged) {
          appendFirePanelMonitorLog("DB firePanelState unchanged — skip write");
        } else {
          appendFirePanelMonitorLog(
            `DB firePanelState → fire=${saved.totalFire} supervisory=${saved.totalSupervisory} trouble=${saved.totalTrouble}`,
          );

          // Pause CVAL polling while list commands + AssetsList updates run on the panel connection
          pauseMonitorLoop();
          appendFirePanelMonitorLog("--- paused for asset sync ---");
          try {
            for (const { label, listCmd } of incrementedValues) {
              if (!isMonitorLoopActive()) break;
              appendFirePanelMonitorLog(`>> ${label} changed — ${listCmd}`);
              try {
                const listResponse = await sendFirePanelListCommandAndWait(listCmd);
                const regex = /\b\d+:M\d+-\d+-\d+\b/g;
                const deviceAddresses = listResponse.match(regex) ?? [];
                const statusKey = simplexKeyForCategoryLabel(label);
                let updatedCount = 0;

                for (const deviceAddress of deviceAddresses) {
                  const assetRef = doc(db, "AssetsList", deviceAddress);
                  const docSnap = await getDoc(assetRef);
                  if (!docSnap.exists()) continue;

                  const data = docSnap.data();
                  const current = readSimplexStatus(data);
                  if (Number(current[statusKey]) === 1) continue;

                  const next = { ...current, [statusKey]: 1 };
                  await updateDoc(assetRef, {
                    simplexStatus: next,
                    updatedAt: new Date().toISOString(),
                  });
                  useAssetFireStatusStore.getState().patchSimplexStatus(
                    docSnap.id,
                    resolveAssetDeviceAddress(data) || data.deviceAddress || deviceAddress,
                    next,
                  );
                  updatedCount += 1;
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
              }
            }
          } finally {
            resumeMonitorLoop();
            appendFirePanelMonitorLog("--- monitoring resumed ---");
          }
        }
      } catch (error) {
        appendFirePanelMonitorLog(`!! save failed: ${error.message}`);
      }

      await new Promise((r) => setTimeout(r, MONITOR_INTERVAL_MS));
    }
  }, [
    appendFirePanelMonitorLog,
    saveFirePanelState,
    sendFirePanelCommand,
    sendFirePanelListCommandAndWait,
    waitWhileMonitorPaused,
  ]);

  const startFirePanelMonitoring = useCallback(() => {
    setFirePanelMonitoringPersisted(true);
    setFirePanelMonitoring(true);

    if (!useFirePanelStore.getState().connected) {
      return { ok: false, reason: "not_connected" };
    }
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

  // Resume monitoring after reload/navigation when panel is still connected
  useEffect(() => {
    void useFirePanelStore.getState().syncStatus();
  }, []);

  useEffect(() => {
    if (firePanelConnected) {
      firePanelWasConnectedRef.current = true;
      if (isFirePanelMonitoringPersisted() && !isMonitorLoopActive()) {
        setMonitorLoopActive(true);
        useAssetFireStatusStore.getState().startPolling();
        appendFirePanelMonitorLog("--- resumed ---");
        void runFirePanelMonitorLoop();
      }
      setFirePanelMonitoring(isFirePanelMonitoringPersisted());
      return;
    }

    // Only stop when connection is lost after being connected (not on initial load)
    if (firePanelWasConnectedRef.current && isMonitorLoopActive()) {
      firePanelWasConnectedRef.current = false;
      stopFirePanelMonitoring();
    }
  }, [
    firePanelConnected,
    appendFirePanelMonitorLog,
    runFirePanelMonitorLoop,
    stopFirePanelMonitoring,
  ]);

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
    acknowledge
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};
