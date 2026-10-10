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
import { getUserCommunities } from "@/utils/communityService";
import { loadBrandRegistry } from "@/utils/brandRegistryService";
import { getStoredSessionUser } from "@/lib/sessionUser";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { apiFetch, parseApiJsonResponse } from "@/lib/apiClient";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { db } from "@/config/firebase";
import {
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
  simplexKeyForCategoryLabel,
} from "@/lib/firePanelMonitor";
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import {
  findDeviceAddressByLocationText,
  findFloorDetailsByLocationText,
} from "@/lib/assetAddressFloorIndex";
import { streamFirePanelListCommand } from "@/lib/firePanelListStream";
import { pickNewestAppearedAddresses } from "@/lib/livePanelListHighlight";
import {
  withMonitorPaused,
} from "@/lib/firePanelMonitorSession";
import { sendPriorityPanelCommand, sendPriorityPanelCommands } from "@/lib/acknowledgePanelDevice";
import { loginToPanel, PANEL_LOGIN_SESSION_MS } from "@/lib/panelLogin";
import {
  deferForFirePriority,
  firePriorityHoldMessage,
  isHeldByFirePriority,
  seedFireCountFromStoredState,
} from "@/lib/firePriority";

// Right after a fire the panel can stay silent ~20s before ACCESS GRANTED shows
// up, so manual commands keep retrying longer than AutoPilot's default (12s).
const MANUAL_LOGIN_MAX_MS = 25000;

/**
 * Log in (with retry) before a command that needs it; throws when access is
 * never granted. A login granted within the panel's 3-minute session is reused.
 */
async function requirePanelLogin() {
  const login = await loginToPanel({
    reuseWithinMs: PANEL_LOGIN_SESSION_MS,
    maxMs: MANUAL_LOGIN_MAX_MS,
  });
  if (!login.granted) {
    throw new Error(`Could not log in to the panel (${login.reason || "no answer"})`);
  }
}
import {
  getLastResetWorkflowStartedAt,
  handleSystemResetCompleteWorkflow,
  resetAllAssetsSimplexStatus,
} from "@/lib/systemResetWorkflow";

/** Re-list F/T/S this long after Reset System if RESET COMPLETE has not done it. */
const RESET_RELIST_FALLBACK_MS = 15000;
import { useFireAlert } from "./FireModalContext";
import { useDeviceEnabledStore } from "@/stores/deviceEnabledStore";
import { LivePanelAlertWatcher } from "@/components/live-panel-alert-watcher";
import { AutoPilotController } from "@/components/autopilot-controller";
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
    firePanelMonitorLogs,
    firePanelState,
    firePanelStateLoading,
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
    firePanelMonitorLogs,
    firePanelState,
    firePanelStateLoading,
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
    // A fire that started during the dump: T / S marker colours stay as they are.
    if (isHeldByFirePriority(label)) {
      deferForFirePriority(label);
    } else {
      useAssetFireStatusStore
        .getState()
        .syncPanelLiveFlagsForCategory(statusKey, addresses, previous);
    }

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
        `>> ${listCmd} (${label ? "streaming" : "waiting for"} dump${expectedCount != null ? `, expect ~${expectedCount} message(s)` : ""
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
          `<< ${listCmd} complete (${messageCount}${expectedCount != null ? `/${expectedCount}` : ""
          } message(s), ${response.length} chars)`,
        );
      } else {
        appendFirePanelMonitorLog(
          `!! ${listCmd}: best effort — have ${messageCount}${expectedCount != null ? `/${expectedCount}` : ""
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
      // Fire first: no `list t` / `list s` while FIRE > 0.
      if (isHeldByFirePriority(label)) {
        deferForFirePriority(label);
        throw new Error(firePriorityHoldMessage(label));
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
            `<< ${listCmd} parsed ${rowCount} row(s), ${addressCount} address(es)${isListResponseComplete(response) ? "" : " (best effort — no _DNE)"
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
    setFirePanelState(nextState);
    return { ...data, ...nextState };
  }, []);

  // `login: false` skips the login when the caller already logged in
  // (AutoPilot). Otherwise the login is retried until ACCESS GRANTED and the
  // set commands are only sent after it (the panel ignores them otherwise).
  const silenceAlarm = useCallback(async ({ login = true } = {}) => {
    muteSiren()
    if (login) await requirePanelLogin();
    // One priority batch: the sets queue back-to-back ahead of any list dump;
    // each set waits for the panel's echo.
    return sendPriorityPanelCommands(["set 2:p217 on", "set 3:p217 on", "set 4:p217 on"], 2000);
  }, [muteSiren]);

  const systemReset = useCallback(async ({ login = true } = {}) => {
    if (login) await requirePanelLogin();
    const result = await sendPriorityPanelCommands(
      ["set 2:p212 on", "set 3:p212 on", "set 4:p212 on"],
      2000,
    );

    // Turn floor markers green immediately while Firestore catches up.
    // useAssetFireStatusStore.getState().clearAllSimplexStatusInStore();

    const resetSentAt = Date.now();
    const runBackgroundReset = async () => {
      try {
        // Clears F/T/S on AssetsList and the list sync's previous addresses, so
        // the next list sync writes every flag again instead of only changes.
        await resetAllAssetsSimplexStatus();
        appendFirePanelMonitorLog("System reset → cleared F/T/S on AssetsList");
      } catch (error) {
        appendFirePanelMonitorLog(`!! system reset background: ${error.message}`);
        console.error("[system reset] background cleanup failed:", error);
      } finally {
        useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
      }
    };

    // The panel prints SYSTEM RESET COMPLETE only when the reset completes (not
    // while e.g. a pull station is still active), and troubles survive a reset.
    // If that line has not started the re-list by now, re-list anyway so the
    // markers show what the panel still reports.
    setTimeout(() => {
      if (getLastResetWorkflowStartedAt() < resetSentAt) {
        appendFirePanelMonitorLog("System reset → no RESET COMPLETE yet, re-listing F/T/S");
        void handleSystemResetCompleteWorkflow();
      }
    }, RESET_RELIST_FALLBACK_MS);

    void runBackgroundReset();
    return result;
  }, [appendFirePanelMonitorLog]);


  // The login is reused while the panel's 3-minute login session is active;
  // otherwise it is retried until ACCESS GRANTED.
  const disableDevice = useCallback(async (deviceAddress) => {
    return withMonitorPaused(async () => {
      await requirePanelLogin();
      const disableResponse = await sendPriorityPanelCommand(`disable ${deviceAddress} on`, 3000);
      useDeviceEnabledStore.getState().setEnabled(deviceAddress, false);
      return disableResponse;
    });
  }, [sendFirePanelCommand]);

  const enableDevice = useCallback(async (deviceAddress) => {
    return withMonitorPaused(async () => {
      await requirePanelLogin();
      const enableResponse = await sendPriorityPanelCommand(`disable ${deviceAddress} off`, 3000);
      useDeviceEnabledStore.getState().setEnabled(deviceAddress, true);
      // FireModalContext clears this device's trouble (T=0, trouble-list row)
      // and updates counts without re-running `list t`.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("vision365:deviceEnabled", { detail: { deviceAddress } }),
        );
      }
      return enableResponse;
    });
  }, []);

  const fetchFirePanelState = useCallback(async () => {
    try {
      const res = await apiFetch("/api/telnet/fire-panel/panel-state");
      if (!res.ok) return;
      const data = await parseApiJsonResponse(res);
      setFirePanelState(data);
      firePanelStateRef.current = data;
      // After a reload mid-fire: hold trouble / supervisory until `show counts` answers.
      seedFireCountFromStoredState(data?.totalFire);
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

  // CVAL polling ("cshow a0/a1/a2 cval" every ~500ms) has been removed entirely.
  // Live fire/trouble/supervisory updates are handled by the SSE stream in
  // FireModalContext, and counts refresh via "show counts" + panel-state polling.
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
      firePanelMonitorLogs,
      firePanelState,
      firePanelStateLoading,
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
      firePanelMonitorLogs,
      firePanelState,
      firePanelStateLoading,
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
      activeDevices,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      <LivePanelAlertWatcher />
      <AutoPilotController />
      {children}
      <FireAlertModal open={isFireAlertOpen} onClose={closeFireAlertModal} />
    </AppContext.Provider>
  );
};
