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
import { useRouter } from "next/navigation";
import { Flame, Loader2, Volume2, VolumeX, MapPin, Radio, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LIVE_FIRE_ROUTE } from "@/config/live-panel-routes";
import { startFireAlertSiren } from "@/lib/fireAlertSiren";
import { acknowledgeCategory, sendPriorityPanelCommand } from "@/lib/acknowledgePanelDevice";
import { acknowledgeFireConfirmed } from "@/lib/confirmedFireAck";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/apiClient";
import { parseShowCountsResponse } from "@/lib/panelState";
import {
  handleSystemResetCompleteWorkflow,
  syncFireListAssets,
  syncTroubleListAssets,
  syncSupervisoryListAssets,
} from "@/lib/systemResetWorkflow";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { waitForAutoPilotListHold } from "@/stores/autoPilotStore";
import {
  appendLiveLogToCategoryList,
  saveListToCategoryDb,
  recordLiveAlarmToHistory,
} from "@/lib/recordAlarmHistory";
import { findAllDeviceAddressesByLocationText } from "@/lib/assetAddressFloorIndex";
import { collectDeviceAddressKeys } from "@/lib/assetFireStatus";
import {
  LIST_COMMAND_TIMEOUT_MS,
  getListCmdForLabel,
  parsePanelListResponse,
  extractPanelDeviceAddresses,
  simplexKeyForCategoryLabel,
  extractPanelEventTime,
} from "@/lib/firePanelMonitor";
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import {
  clearEnabledDeviceTrouble,
  consumeEnabledTroubleDrop,
  expectEnabledTroubleDrop,
} from "@/lib/deviceEnabledSync";
import {
  withMonitorPaused,
} from "@/lib/firePanelMonitorSession";
import {
  deferForFirePriority,
  isFirePriorityActive,
  isHeldByFirePriority,
  noteLiveFireAlarm,
  noteShowCounts,
  setFireClearedHandler,
} from "@/lib/firePriority";

const FireAlertContext = createContext();

export const useFireAlert = () => useContext(FireAlertContext);

/** Fire alert UI — acknowledge, mute siren, and close only. */
function FireAlertModalView({
  open,
  alarmInfo,
  isMuted,
  ackLoading,
  onToggleMute,
  onAcknowledge,
  onClose,
}) {
  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose?.(); }}>
      <DialogContent
        className={cn(
          "flex flex-col gap-0 overflow-hidden border-red-500/60 p-0 shadow-2xl shadow-red-950/40 sm:max-w-[560px] min-h-[480px] max-h-[90vh]",
          "ring-2 ring-red-500/40 ring-offset-2 ring-offset-background",
          "[&>button]:hidden",
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-red-700 via-red-600 to-red-700 px-7 py-6 text-white">
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            aria-hidden
            style={{
              backgroundImage:
                "repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(255,255,255,0.08) 8px, rgba(255,255,255,0.08) 16px)",
            }}
          />
          <DialogHeader className="relative space-y-0 text-left">
            <div className="flex items-center gap-4">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-white/20" />
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/40">
                  <Flame className="h-7 w-7 animate-pulse text-white" aria-hidden />
                </span>
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-100">
                  Critical Alarm Alert
                </p>
                <DialogTitle className="text-2xl font-bold tracking-wide text-white">
                  FIRE ALARM DETECTED
                </DialogTitle>
                <DialogDescription className="text-sm text-red-100/90">
                  Live emergency event received from panel
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="bg-background px-7 pt-6 pb-7 space-y-5 overflow-y-auto flex-1 flex flex-col justify-between">
          <div className="space-y-4">
            <div className="flex items-start gap-2.5 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wide">
                  Live Alarm Notification
                </p>
                <p className="text-sm font-semibold leading-snug text-foreground">
                  A new fire alarm condition was detected on the panel stream.
                </p>
              </div>
            </div>

            {alarmInfo ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5 space-y-3.5 text-left shadow-inner min-h-[105px]">
                {alarmInfo.location ? (
                  <div className="flex items-start gap-2.5 text-foreground font-bold text-base">
                    <MapPin className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    <span className="leading-snug">{alarmInfo.location}</span>
                  </div>
                ) : null}

                <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono text-muted-foreground pt-3 border-t border-red-500/20">
                  {alarmInfo.deviceType ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                      <Radio className="h-3.5 w-3.5" />
                      {alarmInfo.deviceType}
                    </span>
                  ) : null}

                  {alarmInfo.deviceAddress ? (
                    <span className="bg-red-500/20 text-red-700 dark:text-red-300 px-2 py-0.5 rounded font-bold">
                      {alarmInfo.deviceAddress}
                    </span>
                  ) : null}

                  {alarmInfo.panelTime ? (
                    <span className="text-zinc-500">
                      • {alarmInfo.panelTime}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="pt-4 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              variant="destructive"
              className={cn(
                "min-w-[140px] h-10 font-semibold shadow-md",
                !ackLoading && "fire-ack-blink",
              )}
              onClick={onAcknowledge}
              disabled={ackLoading}
            >
              {ackLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  Acknowledging…
                </>
              ) : (
                "Acknowledge"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 font-medium"
              onClick={onToggleMute}
              disabled={ackLoading}
              aria-pressed={isMuted}
              aria-label={isMuted ? "Unmute alarm siren" : "Mute alarm siren"}
            >
              {isMuted ? (
                <>
                  <VolumeX className="h-4 w-4 mr-1.5" />
                  Unmute Siren
                </>
              ) : (
                <>
                  <Volume2 className="h-4 w-4 mr-1.5" />
                  Mute Siren
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 font-medium min-w-[90px]"
              onClick={onClose}
              disabled={ackLoading}
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ADDRESS_IN_TEXT_RE = /\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i;

/**
 * Optimistically clear T and S for the single device a restore message refers
 * to (by address, or by its location text). Ambiguous locations are left to the
 * follow-up list sync.
 */
async function clearRestoredDeviceFlags(entry, rawText) {
  try {
    const direct = entry.pointId || entry.deviceAddress || rawText.match(ADDRESS_IN_TEXT_RE)?.[0];
    const addresses = direct
      ? [direct]
      : entry.location
        ? await findAllDeviceAddressesByLocationText(entry.location)
        : [];
    if (addresses.length !== 1) return;
    const store = useAssetFireStatusStore.getState();
    store.optimisticallySetFlagForAddresses(addresses, "T", 0);
    store.optimisticallySetFlagForAddresses(addresses, "S", 0);
  } catch (error) {
    console.error("[FireModalContext] restore flag clear failed:", error);
  }
}

/** Max time new panel messages are collected before being handled together. */
const LIVE_BATCH_WINDOW_MS = 2000;
/** Most messages looked at together — the batch is handled as soon as it is full. */
const LIVE_BATCH_MAX = 10;
/** Once this many are waiting, a short pause in the stream ends the burst. */
const LIVE_BATCH_MIN_LOOKAHEAD = 5;
const LIVE_BATCH_QUIET_MS = 300;
/** A fire waits only this long, so messages from the same burst are sorted with it. */
const LIVE_FIRE_GRACE_MS = 100;

/** Handling order within a batch (lower first). */
const LIVE_PRIORITY = { fire: 0, supervisory: 1, trouble: 2, other: 3 };

function liveEntryPriority({ isFire, isSupervisory, isTrouble, isAck }) {
  if (isAck) return LIVE_PRIORITY.other;
  if (isFire) return LIVE_PRIORITY.fire;
  if (isSupervisory) return LIVE_PRIORITY.supervisory;
  if (isTrouble) return LIVE_PRIORITY.trouble;
  return LIVE_PRIORITY.other;
}

/**
 * Classify one live panel log entry. Returns null for lines that are not live
 * alarm traffic (command output, CVAL, system banners).
 */
function classifyLiveEntry(entry) {
  if (!entry) return null;

  const rawText = String(entry.raw || "");
  const locText = String(entry.location || "");
  const descText = String(entry.description || "");
  const devText = String(entry.device || "");

  // Ignore show counts, show <address>, PRIMARY STATUS, and device property queries
  const allText = `${rawText} ${locText} ${descText} ${devText} ${String(entry.status || "")} ${String(entry.category || "")}`;
  if (
    /show\s+counts|FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+/i.test(allText) ||
    /\bshow\b|PRIMARY\s+STATUS|ENABLED\s+STATE|CUSTOM\s+LABEL|DEVICE\s+TYPE|POINT\s+TYPE|RAW\s+ANALOG|ALARM\s+THRESHOLD|CARD\s+TYPE/i.test(allText)
  ) {
    return null;
  }

  if (entry.kind === "cval" || entry.kind === "noise" || entry.kind === "system") {
    return null;
  }

  const statusText = String(entry.status || "");
  const catText = String(entry.category || "");

  // A device returning to normal ("NORMAL", "... CLEARED", "... RESTORED") is
  // never a new alarm, even when the status mentions TROUBLE or the device is
  // a SUPERVISORY MONITOR. "NORMAL ACKED" stays an acknowledgement.
  const isRestore =
    !entry.isListEntry &&
    !/ACKED/i.test(statusText) &&
    /\bNORMAL\b|CLEAR|RESTOR/i.test(statusText);

  // Check if this is an explicit fire alarm event (highest priority — live event, not passive list dump)
  const isFire =
    (entry.kind === "fire" ||
      catText === "fire" ||
      /^FIRE\s+ALARM$|^FIRE$/i.test(statusText) ||
      /FIRE\s+ALARM/i.test(rawText)) &&
    !entry.isListEntry &&
    !isRestore;

  // Check if this is an ACK event
  const isAck =
    entry.kind === "fire-acknowledged" ||
    entry.kind === "acknowledged" ||
    entry.acknowledged === true ||
    /ACKED/i.test(statusText) ||
    statusText === "NORMAL ACKED" ||
    /NORMAL\s+ACKED|FIRE\s+ALARM\s+ACKED/i.test(rawText);

  // Check if event is trouble (live event, not passive list dump)
  const isTrouble =
    (entry.kind === "trouble" ||
      catText === "trouble" ||
      /TROUBLE|TRBL|DIRTY/i.test(statusText)) &&
    !entry.isListEntry &&
    !isRestore;

  // Check if event is supervisory (live event, not passive list dump)
  const isSupervisory =
    (entry.kind === "supervisory" ||
      catText === "supervisory" ||
      /SUPERVISORY|SUPV|SUPR/i.test(statusText) ||
      /SUPERVISORY/i.test(String(entry.device || ""))) &&
    !entry.isListEntry &&
    !isRestore;

  // Check if event is system reset
  const isReset =
    entry.kind === "reset-complete" ||
    entry.kind === "reset-normal" ||
    entry.kind === "reset-in-progress" ||
    entry.kind === "reset-aborted" ||
    entry.kind === "reset";

  return { rawText, statusText, isRestore, isFire, isAck, isTrouble, isSupervisory, isReset };
}

/** "2:M1-2-0" / "M1-2-0" → "M1-2-0" so the same device always matches. */
function fireAddressKey(address) {
  return String(address || "").trim().toUpperCase().replace(/^\d+:/, "");
}

/**
 * AutoPilot hook: announce every live panel line the moment it arrives (before
 * batching) as an alarm or an acknowledgement for one category. Fire > Trouble
 * > Supervisory when a line matches more than one.
 */
function announceLivePanelEntry(entry, classified, receivedAt) {
  if (typeof window === "undefined") return;
  const { rawText, statusText, isFire, isAck, isTrouble, isSupervisory } = classified;
  let type = null;
  let label = null;
  if (isAck) {
    const isFireAck =
      entry.kind === "fire-acknowledged" ||
      /FIRE\s+ALARM\s+ACKED/i.test(statusText) ||
      /FIRE\s+ALARM\s+ACKED/i.test(rawText);
    type = "ack";
    label = isFireAck ? "Fire" : isSupervisory && !isTrouble ? "Supervisory" : "Trouble";
  } else if (isFire || isTrouble || isSupervisory) {
    type = "alarm";
    label = isFire ? "Fire" : isTrouble ? "Trouble" : "Supervisory";
  }
  if (!type) return;
  window.dispatchEvent(
    new CustomEvent("vision365:livePanelEntry", {
      detail: { type, label, entry, receivedAt },
    }),
  );
}

export function FireAlertProvider({ children }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isFireAlertOpen, setIsFireAlertOpen] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isSirenMuted, setIsSirenMuted] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);
  const [activeAlarmInfo, setActiveAlarmInfo] = useState(null);
  // Navbar "Fire Ack" button blinks from a new live fire until it is clicked
  // or a fire acknowledgement (FIRE ALARM ACKED) arrives in the panel logs.
  const [isFireAckPending, setIsFireAckPending] = useState(false);
  // Fire addresses behind the current blink, and those already acknowledged
  // (Ack clicked): the panel often repeats a fire line after the ack (glued
  // into a later reply) — that repeat must not restart the blink. Cleared on
  // SYSTEM RESET COMPLETE.
  const fireBlinkAddressesRef = useRef(new Set());
  const ackedFireAddressesRef = useRef(new Set());
  // Navbar "Trouble Ack" / "Sup Ack" buttons blink from a new live trouble /
  // supervisory event until they are clicked or a matching ack is logged.
  const [isTroubleAckPending, setIsTroubleAckPending] = useState(false);
  const [isSupervisoryAckPending, setIsSupervisoryAckPending] = useState(false);
  const stopSirenRef = useRef(null);
  // Set per-category when a new message's location text resolves to more
  // than one AssetsList device — resolved with a `list f/t/s` dump once
  // that category's acknowledge succeeds (see runPostAckListSync).
  const ambiguousLocationRef = useRef({ Fire: false, Trouble: false, Supervisory: false });
  // Last known counts from any "show counts" call — used by the "NORMAL ACKED"
  // handler to detect a per-category decrease (see fetchAndSyncCounts).
  // null until the first check, which starts from the counts saved by the
  // startup list sync — starting from 0 re-listed every trouble (215 rows,
  // ~20s of panel time) on the first alarm after each page load.
  const previousCountsRef = useRef(null);
  const recentLiveAlarmHistoryRef = useRef(new Map());

  const showFireAlert = useCallback((alarmInfo = null) => {
    if (alarmInfo) {
      setActiveAlarmInfo(alarmInfo);
    }
    setAckLoading(false);
    setIsAlarmActive(true);
    setIsSirenMuted(false);
    setIsFireAlertOpen(true);
  }, []);

  const hideFireAlert = useCallback(() => {
    setIsFireAlertOpen(false);
    setIsAlarmActive(false);
    setIsSirenMuted(false);
    setAckLoading(false);
    setActiveAlarmInfo(null);
  }, []);

  const closeFireAlertModal = useCallback(() => {
    setIsFireAlertOpen(false);
  }, []);

  /** Stop the navbar Fire Ack blink (Ack clicked / fire acknowledged). */
  const clearFireAckPending = useCallback(() => {
    for (const key of fireBlinkAddressesRef.current) ackedFireAddressesRef.current.add(key);
    fireBlinkAddressesRef.current.clear();
    setIsFireAckPending(false);
  }, []);

  const clearTroubleAckPending = useCallback(() => {
    setIsTroubleAckPending(false);
  }, []);

  const clearSupervisoryAckPending = useCallback(() => {
    setIsSupervisoryAckPending(false);
  }, []);

  // Live stream and debug simulator both announce new trouble / supervisory
  // events through these window events.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleNewTrouble = () => setIsTroubleAckPending(true);
    const handleNewSupervisory = () => setIsSupervisoryAckPending(true);
    window.addEventListener("vision365:newTroubleEvent", handleNewTrouble);
    window.addEventListener("vision365:newSupervisoryEvent", handleNewSupervisory);
    return () => {
      window.removeEventListener("vision365:newTroubleEvent", handleNewTrouble);
      window.removeEventListener("vision365:newSupervisoryEvent", handleNewSupervisory);
    };
  }, []);

  const toggleSirenMute = useCallback(() => {
    setIsSirenMuted((prev) => !prev);
  }, []);

  const muteSiren = useCallback(() => {
    setIsSirenMuted(true);
  }, []);

  const unmuteSiren = useCallback(() => {
    setIsSirenMuted(false);
  }, []);

  const fetchAndSyncCounts = useCallback(async () => {
    try {
      const cmdUrl = apiUrl("/api/telnet/fire-panel/command");
      const res = await fetch(cmdUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: "show counts" }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const rawText = typeof data === "string" ? data : (data?.response || data?.raw || "");
      const counts = parseShowCountsResponse(rawText);
      if (!counts) return;
      noteShowCounts(counts);

      // Baseline for the change check below (read before this call saves new counts).
      let previous = previousCountsRef.current;
      if (!previous) {
        previous = { totalFire: 0, totalTrouble: 0, totalSupervisory: 0 };
        try {
          const storedRes = await fetch(apiUrl("/api/telnet/fire-panel/panel-state"));
          if (storedRes.ok) {
            const stored = await storedRes.json();
            previous = {
              totalFire: Number(stored?.totalFire) || 0,
              totalTrouble: Number(stored?.totalTrouble) || 0,
              totalSupervisory: Number(stored?.totalSupervisory) || 0,
            };
          }
        } catch {
          // keep the zero baseline
        }
      }

      // 1. Save to backend database
      const stateUrl = apiUrl("/api/telnet/fire-panel/panel-state");
      await fetch(stateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalFire: counts.totalFire,
          totalSupervisory: counts.totalSupervisory,
          totalTrouble: counts.totalTrouble,
        }),
      });

      // 2. Dispatch custom event to immediately update AppContext & UI
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("vision365:firePanelStateUpdated", { detail: counts }),
        );
      }

      // 3. Reconcile categories whose count changed. The counts we just read are
      //    passed through so each sync skips its own `show counts`; the diff in
      //    syncAssetsListWithPanelList clears devices that dropped off the list.
      previousCountsRef.current = {
        totalFire: counts.totalFire,
        totalTrouble: counts.totalTrouble,
        totalSupervisory: counts.totalSupervisory,
      };
      const syncs = [];
      if (isFirePriorityActive()) {
        // Fire first: no `list t` / `list s` while FIRE > 0 — re-listed once it is 0.
        if (counts.totalTrouble !== previous.totalTrouble) deferForFirePriority("Trouble");
        if (counts.totalSupervisory !== previous.totalSupervisory) deferForFirePriority("Supervisory");
      } else {
        // A drop caused only by re-enabled devices was already applied locally
        // (T=0 + trouble-list row removed) — no `list t` for it.
        const troubleDrop = previous.totalTrouble - counts.totalTrouble;
        if (troubleDrop > 0 && consumeEnabledTroubleDrop(troubleDrop)) {
          // handled by the device-enabled path
        } else if (counts.totalTrouble !== previous.totalTrouble) {
          syncs.push(syncTroubleListAssets({ expectedCount: counts.totalTrouble }));
        }
        if (counts.totalSupervisory !== previous.totalSupervisory) {
          syncs.push(syncSupervisoryListAssets({ expectedCount: counts.totalSupervisory }));
        }
      }
      // Any drop in the fire count re-syncs the fire list. A fire at a single
      // device only set a live F flag (no DB write), so without this its
      // marker stayed red after the fire cleared. At 0 fires no command is
      // sent — every F flag is simply cleared.
      if (counts.totalFire < previous.totalFire) {
        syncs.push(syncFireListAssets({ expectedCount: counts.totalFire }));
      }
      await Promise.allSettled(syncs);
    } catch (err) {
      console.error("[FireModalContext] fetchAndSyncCounts failed:", err);
    }
  }, []);

  /**
   * Lower the trouble count by one without asking the panel (`show counts`).
   * The desktop server treats this drop as expected after `disable <addr> off`,
   * so saving it does not run `list t` there either.
   */
  const applyEnabledTroubleDrop = useCallback(async () => {
    try {
      let current = previousCountsRef.current;
      if (!current) {
        const res = await fetch(apiUrl("/api/telnet/fire-panel/panel-state"));
        if (!res.ok) return;
        const stored = await res.json();
        current = {
          totalFire: Number(stored?.totalFire) || 0,
          totalTrouble: Number(stored?.totalTrouble) || 0,
          totalSupervisory: Number(stored?.totalSupervisory) || 0,
        };
      }
      const counts = { ...current, totalTrouble: Math.max(0, current.totalTrouble - 1) };
      previousCountsRef.current = counts;

      await fetch(apiUrl("/api/telnet/fire-panel/panel-state"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(counts),
      });
      window.dispatchEvent(new CustomEvent("vision365:firePanelStateUpdated", { detail: counts }));
    } catch (err) {
      console.error("[FireModalContext] applyEnabledTroubleDrop failed:", err);
    }
  }, []);

  // A device was re-enabled: set its T to 0, drop its trouble-list row and
  // lower the trouble count by one locally — no `show counts`, no `list t`.
  // The expected trouble-count drop is registered first so a restore line's
  // counts check (which may run meanwhile) cannot re-list either; when that
  // check already applied the drop, the count is not lowered a second time.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleDeviceEnabled = async (e) => {
      const deviceAddress = e?.detail?.deviceAddress;
      if (!deviceAddress) return;
      // During a fire the device's T flag / trouble row stay as they are; the
      // trouble list is re-read once the fire count is 0.
      if (isFirePriorityActive()) {
        deferForFirePriority("Trouble");
        return;
      }
      const withdrawExpectedDrop = expectEnabledTroubleDrop();
      await clearEnabledDeviceTrouble(deviceAddress);
      if (!withdrawExpectedDrop()) return;
      await applyEnabledTroubleDrop();
    };
    window.addEventListener("vision365:deviceEnabled", handleDeviceEnabled);
    return () => window.removeEventListener("vision365:deviceEnabled", handleDeviceEnabled);
  }, [applyEnabledTroubleDrop]);

  // Fire count back to 0: catch up the trouble / supervisory work held during
  // the fire — re-list each skipped category (`list t` / `list s`, T / S flags,
  // lists) and raise the alerts of alarms that arrived meanwhile.
  useEffect(
    () =>
      setFireClearedHandler(async ({ counts, sync, alert }) => {
        console.log("[FireModalContext] fire count is 0 — resuming trouble / supervisory:", { sync, alert });
        const syncs = [];
        if (sync.Trouble) {
          syncs.push(syncTroubleListAssets({ expectedCount: counts?.totalTrouble }));
        }
        if (sync.Supervisory) {
          syncs.push(syncSupervisoryListAssets({ expectedCount: counts?.totalSupervisory }));
        }
        if (typeof window !== "undefined") {
          const detail = { receivedAt: Date.now() };
          if (alert.Trouble) window.dispatchEvent(new CustomEvent("vision365:newTroubleEvent", { detail }));
          if (alert.Supervisory) window.dispatchEvent(new CustomEvent("vision365:newSupervisoryEvent", { detail }));
        }
        await Promise.allSettled(syncs);
      }),
    [],
  );

  /**
   * Runs only when a message in this category had an ambiguous (multi-device)
   * location AND that category's acknowledge just succeeded. Sends `list f/t/s`,
   * waits for the full response, saves it to {label}-list so the live page
   * (which reads that doc via onSnapshot) picks it up, and logs the response.
   *
   * Ack/silence/reset issued while this runs preempt it in the panel worker;
   * the list dump is restarted afterwards and this call still gets the full list.
   */
  const runPostAckListSync = useCallback(async (label) => {
    if (!ambiguousLocationRef.current[label]) return;
    ambiguousLocationRef.current[label] = false;
    // No `list t` / `list s` during a fire — the deferred re-list covers it.
    if (isHeldByFirePriority(label)) {
      deferForFirePriority(label);
      return;
    }

    const listCmd = getListCmdForLabel(label);
    if (!listCmd) return;

    try {
      // Not during an AutoPilot sequence (no-op when AutoPilot is idle).
      await waitForAutoPilotListHold();
      const result = await withMonitorPaused(() =>
        sendPriorityPanelCommand(listCmd, LIST_COMMAND_TIMEOUT_MS),
      );
      const rawText = result?.response ?? "";
      console.log(
        `[FireModalContext] post-ack ${listCmd} response (ambiguous location resolved):`,
        rawText,
      );
      const parsedRows = parsePanelListResponse(rawText);
      await saveListToCategoryDb(label, parsedRows);
      console.log(
        `[FireModalContext] ${label.toLowerCase()}-list saved: ${parsedRows.length} row(s)`,
      );

      // Update each listed device's F/T/S flag in AssetsList (and the live
      // floor-map marker store) — saving to {label}-list alone does not
      // touch device status, only the list page's row data.
      const deviceAddresses = extractPanelDeviceAddresses(rawText);
      const { updatedCount, clearedCount } = await syncAssetsListWithPanelList(
        label,
        deviceAddresses,
      );
      console.log(
        `[FireModalContext] ${label} device status synced → set ${simplexKeyForCategoryLabel(label)}=1: ${updatedCount}, cleared: ${clearedCount}`,
      );
      useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
    } catch (error) {
      console.error(`[FireModalContext] post-ack ${listCmd} failed:`, error);
    }
  }, []);

  const handleAcknowledge = useCallback(() => {
    // Stop the navbar Fire Ack blink on click — no wait for FIRE ALARM ACKED.
    clearFireAckPending();
    const connected = useFirePanelStore.getState().connected;
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before acknowledging.",
        variant: "destructive",
      });
      return;
    }

    // Instantly mute siren, close modal, and route for immediate responsiveness
    muteSiren();
    closeFireAlertModal();
    // Run the ack and count sync in the background. No unconditional `list f`
    // here — only one afterward if a fire message this alarm had an ambiguous
    // (multi-device) location, and only once the ack has succeeded.
    void (async () => {
      let ackSucceeded = false;
      try {
        // One ack, confirmed by the panel worker ("- ack" executed).
        const result = await acknowledgeFireConfirmed();
        ackSucceeded = result.acknowledged;
        console.log("[FireModalContext] fire ack:", result);
      } catch (err) {
        console.error("[FireModalContext] ack f failed:", err);
      }
      try {
        await fetchAndSyncCounts();
      } catch (err) {
        console.error("[FireModalContext] fetchAndSyncCounts failed:", err);
      }

      if (ackSucceeded) {
        void runPostAckListSync("Fire");
      }
    })();
    router.push(LIVE_FIRE_ROUTE);
  }, [clearFireAckPending, closeFireAlertModal, fetchAndSyncCounts, muteSiren, router, runPostAckListSync, toast]);

  /**
   * AutoPilot fire acknowledge — same UI steps as the modal's Acknowledge
   * (mute siren, close modal, open Live Fire), but awaitable and toast-free.
   * Resolves true once the priority `ack` returns OK.
   */
  const autoAcknowledgeFire = useCallback(async () => {
    muteSiren();
    closeFireAlertModal();
    clearFireAckPending();
    router.push(LIVE_FIRE_ROUTE);

    // One ack; resolves true once the panel worker saw it executed ("- ack").
    const result = await acknowledgeFireConfirmed();
    console.log("[FireModalContext] AutoPilot fire ack:", result);
    void fetchAndSyncCounts().catch(() => {});
    if (result.acknowledged) void runPostAckListSync("Fire");
    return result.acknowledged;
  }, [clearFireAckPending, closeFireAlertModal, fetchAndSyncCounts, muteSiren, router, runPostAckListSync]);

  // Siren runs while alarm is active or modal is open (and not muted)
  useEffect(() => {
    if (!isAlarmActive || isSirenMuted) {
      stopSirenRef.current?.();
      stopSirenRef.current = null;
      return;
    }

    // Stop any stale siren handle and start fresh sound
    stopSirenRef.current?.();
    stopSirenRef.current = startFireAlertSiren();

    return () => {
      stopSirenRef.current?.();
      stopSirenRef.current = null;
    };
  }, [isAlarmActive, isSirenMuted, isFireAlertOpen]);

  // ── Realtime SSE listener: trigger modal whenever a new fire alarm arrives ──
  useEffect(() => {
    let active = true;
    let eventSource = null;
    let reconnectTimer = null;
    // Arrival time per live entry (kept off the entry so it is never saved).
    const receivedAtByEntry = new WeakMap();

    // AutoPilot hook: the row for this message is now on its live list page.
    const announceLiveAlarmListed = (label, entry) => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("vision365:liveAlarmListed", {
          detail: { label, receivedAt: receivedAtByEntry.get(entry) },
        }),
      );
    };

    const processEntry = async (entry) => {
      const classified = classifyLiveEntry(entry);
      if (!classified) return;
      const { rawText, statusText, isRestore, isFire, isAck, isTrouble, isSupervisory, isReset } =
        classified;

      // If new unacknowledged fire alarm detected -> popup fire modal & update device F value to 1!
      if (isFire && !isAck) {
        const fireAddr =
          entry.pointId ||
          entry.deviceAddress ||
          rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] ||
          "";

        const { timeMs: fireTimeMs, timestampIso: fireTimestampIso, panelTimeText: firePanelTimeText } =
          extractPanelEventTime(entry);

        // A repeat of an already-acknowledged fire does not restart the blink.
        const fireKey = fireAddressKey(fireAddr);
        if (!fireKey || !ackedFireAddressesRef.current.has(fireKey)) {
          if (fireKey) fireBlinkAddressesRef.current.add(fireKey);
          setIsFireAckPending(true);
        }
        showFireAlert({
          location: entry.location || "Fire Alarm Detected",
          deviceType: entry.device || entry.deviceType || entry.description || "Fire Device",
          deviceAddress: fireAddr,
          panelTime: firePanelTimeText || (entry.at ? new Date(entry.at).toLocaleString() : new Date().toLocaleString()),
          raw: entry.raw,
        });

        if (fireAddr) {
          console.log(`[FireModalContext] Updating F value for fire device: ${fireAddr}`);
          // Optimistic single-device patch only — this in-memory store update
          // does not touch the fire-list DB.
          useAssetFireStatusStore.getState().optimisticallySetFlagForAddresses([fireAddr], "F", 1);
        }

        // Resolve the device address(es) from the fire message's location text
        // (via AssetsList) and log it as a `list f` dump row would read.
        const fireLocation = entry.location || "";
        const fireDeviceType =
          entry.device || entry.deviceType || entry.description || "FIRE DEVICE";

        await (async () => {
          try {
            const resolvedAddresses = await findAllDeviceAddressesByLocationText(fireLocation);
            let fireAddrToUse = "NA";

            if (resolvedAddresses.length > 1) {
              ambiguousLocationRef.current.Fire = true;
              fireAddrToUse = "NA";
              console.log(
                "[FireModalContext] fire location matches multiple devices — fetching list f now:",
                fireLocation,
                resolvedAddresses,
              );
              try {
                const result = await withMonitorPaused(() =>
                  sendPriorityPanelCommand("list f", LIST_COMMAND_TIMEOUT_MS),
                );
                const rawListText = result?.response ?? "";
                const parsedRows = parsePanelListResponse(rawListText);
                await saveListToCategoryDb("Fire", parsedRows);
                const deviceAddresses = extractPanelDeviceAddresses(rawListText);
                await syncAssetsListWithPanelList("Fire", deviceAddresses);
                useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
                console.log(
                  `[FireModalContext] fire-list saved from list f: ${parsedRows.length} row(s), synced ${deviceAddresses.length} device address(es)`,
                );
              } catch (err) {
                console.error("[FireModalContext] list f failed:", err);
              }
            } else {
              fireAddrToUse = resolvedAddresses.length === 1 ? resolvedAddresses[0] : fireAddr || "NA";
              // Add this fire to fire-list (keeping every other active fire) —
              // replacing the list with this one row hid earlier fires.
              await appendLiveLogToCategoryList("Fire", {
                ...entry,
                deviceAddress: fireAddrToUse,
                fullAddress: fireAddrToUse,
                location: fireLocation || "—",
                deviceType: fireDeviceType,
                time: fireTimeMs,
                timestamp: fireTimestampIso,
                panelTimeText: firePanelTimeText,
              });
              console.log("[FireModalContext] new fire added to fire-list:", fireAddrToUse, fireLocation);
              if (fireAddrToUse !== "NA") {
                useAssetFireStatusStore.getState().optimisticallySetFlagForAddresses([fireAddrToUse], "F", 1);
              }
            }

            const listFHistoryItem = [fireAddrToUse, fireLocation, fireDeviceType, "FIRE*"]
              .filter(Boolean)
              .join("   ");

            const dedupKey = `Fire:${listFHistoryItem}`;
            const lastRecorded = recentLiveAlarmHistoryRef.current.get(dedupKey) || 0;
            if (Date.now() - lastRecorded >= 30000) {
              recentLiveAlarmHistoryRef.current.set(dedupKey, Date.now());
              void recordLiveAlarmToHistory("Fire", {
                listItem: listFHistoryItem,
                raw: entry.raw,
                deviceAddress: fireAddrToUse,
                time: fireTimeMs,
                timestamp: fireTimestampIso,
              });
            }
          } catch (error) {
            console.error("[FireModalContext] findAllDeviceAddressesByLocationText failed:", error);
          }
        })();
        announceLiveAlarmListed("Fire", entry);
      }

      // Fire first: while FIRE > 0 a new trouble / supervisory message only adds
      // its row to the Live Trouble / Live Supervisory page — no T / S colour,
      // no `list t` / `list s`, no history, no alert. The category is re-listed
      // (and alerted) once the fire count is 0. Only `show counts` still runs.
      const holdTrouble = isTrouble && !isAck && isFirePriorityActive();
      const holdSupervisory = isSupervisory && !isAck && isFirePriorityActive();
      for (const [held, label, fallbackType] of [
        [holdTrouble, "Trouble", "TROUBLE POINT"],
        [holdSupervisory, "Supervisory", "SUPERVISORY"],
      ]) {
        if (!held) continue;
        deferForFirePriority(label, { alert: true });
        const { timeMs, timestampIso, panelTimeText } = extractPanelEventTime(entry);
        const address =
          entry.pointId || entry.deviceAddress || rawText.match(ADDRESS_IN_TEXT_RE)?.[0] || "NA";
        try {
          await appendLiveLogToCategoryList(
            label,
            {
              ...entry,
              deviceAddress: address,
              fullAddress: address,
              location: entry.location || "—",
              deviceType: entry.device || entry.deviceType || entry.description || fallbackType,
              time: timeMs,
              timestamp: timestampIso,
              panelTimeText,
            },
            { duringFire: true },
          );
        } catch (error) {
          console.error(`[FireModalContext] ${label} row during fire failed:`, error);
        }
      }

      // If new unacknowledged trouble log arrives -> append to trouble-list DB & update T value to 1
      if (isTrouble && !isAck && !holdTrouble) {
        const trblAddr =
          entry.pointId ||
          entry.deviceAddress ||
          rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] ||
          "";

        const { timeMs: trblTimeMs, timestampIso: trblTimestampIso, panelTimeText: trblPanelTimeText } =
          extractPanelEventTime(entry);

        // LivePanelAlertProvider owns the trouble beep/modal but sits below this
        // provider in the tree, so signal it via a window event (same pattern as
        // vision365:firePanelStateUpdated) instead of calling its hook directly.
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("vision365:newTroubleEvent", {
              detail: { receivedAt: receivedAtByEntry.get(entry) },
            }),
          );
        }

        const troubleLocation = entry.location || "";
        const troubleDeviceType =
          entry.device || entry.deviceType || entry.description || "TROUBLE POINT";

        await (async () => {
          try {
            let trblAddrToUse = trblAddr || "NA";
            if (!trblAddr && troubleLocation) {
              const resolvedAddresses = await findAllDeviceAddressesByLocationText(troubleLocation);
              if (resolvedAddresses.length === 1) {
                trblAddrToUse = resolvedAddresses[0];
              } else if (resolvedAddresses.length > 1) {
                ambiguousLocationRef.current.Trouble = true;
                trblAddrToUse = "NA";
                console.log(
                  "[FireModalContext] trouble location matches multiple devices — will re-list after ack:",
                  troubleLocation,
                  resolvedAddresses,
                );
              }
            }

            // Always append live trouble log to trouble-list
            await appendLiveLogToCategoryList("Trouble", {
              ...entry,
              deviceAddress: trblAddrToUse,
              fullAddress: trblAddrToUse,
              location: troubleLocation || entry.location || "—",
              deviceType: troubleDeviceType,
              time: trblTimeMs,
              timestamp: trblTimestampIso,
              panelTimeText: trblPanelTimeText,
            });
            console.log("[Trouble]: New Trouble added to categoryList:", entry, trblAddrToUse);

            if (trblAddrToUse && trblAddrToUse !== "NA") {
              useAssetFireStatusStore.getState().optimisticallySetFlagForAddresses([trblAddrToUse], "T", 1);
            }

            const listTItem = [trblAddrToUse, troubleLocation, troubleDeviceType, "TRBL*"]
              .filter(Boolean)
              .join("   ");
            console.log("[Trouble]: new trouble as list t item:", listTItem);

            const dedupKey = `Trouble:${listTItem}`;
            const lastRecorded = recentLiveAlarmHistoryRef.current.get(dedupKey) || 0;
            if (Date.now() - lastRecorded >= 30000) {
              recentLiveAlarmHistoryRef.current.set(dedupKey, Date.now());
              void recordLiveAlarmToHistory("Trouble", {
                listItem: listTItem,
                raw: entry.raw,
                deviceAddress: trblAddrToUse,
                time: trblTimeMs,
                timestamp: trblTimestampIso,
              });
            }
          } catch (error) {
            console.error("[FireModalContext] trouble event processing failed:", error);
          }
        })();
        announceLiveAlarmListed("Trouble", entry);
      }

      // If new unacknowledged supervisory log arrives -> append to supervisory-list DB & update S value to 1
      if (isSupervisory && !isAck && !holdSupervisory) {
        const supAddr =
          entry.pointId ||
          entry.deviceAddress ||
          rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] ||
          "";

        const { timeMs: supTimeMs, timestampIso: supTimestampIso, panelTimeText: supPanelTimeText } =
          extractPanelEventTime(entry);

        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("vision365:newSupervisoryEvent", {
              detail: { receivedAt: receivedAtByEntry.get(entry) },
            }),
          );
        }

        const supervisoryLocation = entry.location || "";
        const supervisoryDeviceType =
          entry.device || entry.deviceType || entry.description || "SUPERVISORY";

        await (async () => {
          try {
            let supAddrToUse = supAddr || "NA";
            // Set when `list s` already replaced supervisory-list below.
            let supListSaved = false;
            if (!supAddr && supervisoryLocation) {
              const resolvedAddresses = await findAllDeviceAddressesByLocationText(supervisoryLocation);
              if (resolvedAddresses.length === 1) {
                supAddrToUse = resolvedAddresses[0];
              } else if (resolvedAddresses.length > 1) {
                ambiguousLocationRef.current.Supervisory = true;
                supAddrToUse = "NA";
                console.log(
                  "[FireModalContext] supervisory location matches multiple devices — fetching list s now:",
                  supervisoryLocation,
                  resolvedAddresses,
                );
                // Same as fire's `list f`: the panel list names the real address,
                // so the row does not sit at "NA" until an ack.
                try {
                  const result = await withMonitorPaused(() =>
                    sendPriorityPanelCommand("list s", LIST_COMMAND_TIMEOUT_MS),
                  );
                  const rawListText = result?.response ?? "";
                  const parsedRows = parsePanelListResponse(rawListText);
                  await saveListToCategoryDb("Supervisory", parsedRows);
                  const deviceAddresses = extractPanelDeviceAddresses(rawListText);
                  await syncAssetsListWithPanelList("Supervisory", deviceAddresses);
                  useAssetFireStatusStore.getState().scheduleSyncFromAssetsList();
                  supListSaved = true;

                  // Compare address variants so "2:M1-32" and "2:M1-32-0" match.
                  const candidateKeys = new Set(
                    resolvedAddresses.flatMap((a) => [...collectDeviceAddressKeys(a)]),
                  );
                  const listed = [
                    ...new Set(
                      parsedRows
                        .map((row) => String(row.fullAddress || row.deviceAddress || "").toUpperCase())
                        .filter((addr) =>
                          [...collectDeviceAddressKeys(addr)].some((key) => candidateKeys.has(key)),
                        ),
                    ),
                  ];
                  if (listed.length === 1) supAddrToUse = listed[0];
                  console.log(
                    `[FireModalContext] supervisory-list saved from list s: ${parsedRows.length} row(s), resolved address: ${supAddrToUse}`,
                  );
                } catch (err) {
                  console.error("[FireModalContext] list s failed:", err);
                }
              }
            }

            // Append the live supervisory log to supervisory-list, unless
            // `list s` above already replaced the list with the panel's rows.
            if (!supListSaved) {
              await appendLiveLogToCategoryList("Supervisory", {
                ...entry,
                deviceAddress: supAddrToUse,
                fullAddress: supAddrToUse,
                location: supervisoryLocation || entry.location || "—",
                deviceType: supervisoryDeviceType,
                time: supTimeMs,
                timestamp: supTimestampIso,
                panelTimeText: supPanelTimeText,
              });
            }
            console.log("[Supervisory]: New Supervisory added to categoryList:", entry, supAddrToUse);

            if (supAddrToUse && supAddrToUse !== "NA") {
              useAssetFireStatusStore.getState().optimisticallySetFlagForAddresses([supAddrToUse], "S", 1);
            }

            const listSItem = [supAddrToUse, supervisoryLocation, supervisoryDeviceType, "SUPV*"]
              .filter(Boolean)
              .join("   ");
            console.log("[Supervisory]: new supervisory as list s item:", listSItem);

            const dedupKey = `Supervisory:${listSItem}`;
            const lastRecorded = recentLiveAlarmHistoryRef.current.get(dedupKey) || 0;
            if (Date.now() - lastRecorded >= 30000) {
              recentLiveAlarmHistoryRef.current.set(dedupKey, Date.now());
              void recordLiveAlarmToHistory("Supervisory", {
                listItem: listSItem,
                raw: entry.raw,
                deviceAddress: supAddrToUse,
                time: supTimeMs,
                timestamp: supTimestampIso,
              });
            }
          } catch (error) {
            console.error("[FireModalContext] supervisory event processing failed:", error);
          }
        })();
        announceLiveAlarmListed("Supervisory", entry);
      }

      // If system reset completed, dismiss active fire alert and run full post-reset reconciliation workflow
      if (entry.kind === "reset-complete" || /SYSTEM\s+RESET\s+COMPLETE/i.test(statusText)) {
        hideFireAlert();
        ackedFireAddressesRef.current.clear();
        void handleSystemResetCompleteWorkflow();
        return;
      }

      // If fire acknowledged log arrives: run show counts only.
      // No list f here — the fire list is only refreshed via
      // handleSystemResetCompleteWorkflow's reset-complete path.
      const isFireAck =
        entry.kind === "fire-acknowledged" ||
        /FIRE\s+ALARM\s+ACKED/i.test(statusText) ||
        /FIRE\s+ALARM\s+ACKED/i.test(rawText);

      if (isFireAck) {
        clearFireAckPending();
        requestCountsCheck();
        return;
      }

      // Any other acknowledgement stops the matching navbar Ack button blink:
      // a SUPERVISORY device/status → Sup Ack, everything else → Trouble Ack.
      if (isAck) {
        if (isSupervisory) setIsSupervisoryAckPending(false);
        else setIsTroubleAckPending(false);
      }

      // If the panel reports "NORMAL ACKED": something was acknowledged/cleared
      // off-panel. Check show counts and, per category, if that category's
      // total decreased, hard-reset its F/T/S flags + list and re-list it.
      const isNormalAcked =
        statusText === "NORMAL ACKED" || /NORMAL\s+ACKED/i.test(rawText);

      if (isNormalAcked) {
        requestCountsCheck(true);
        return;
      }

      // Trouble / supervisory cleared on the panel. The restore line does not say
      // which category cleared, so clear T and S on that device at once (marker
      // recolors immediately); `show counts` then re-lists whichever category's
      // count changed — the authoritative update. Unrecognised live lines ("other",
      // e.g. a status lost to a glued command echo) get the same counts check so
      // a clear is never missed.
      if (isRestore || (entry.kind === "other" && !isAck && !entry.isListEntry)) {
        if (isRestore) {
          // During a fire the T / S colours stay; both lists are re-read after it.
          if (isFirePriorityActive()) deferForFirePriority("both");
          else void clearRestoredDeviceFlags(entry, rawText);
        }
        requestCountsCheck(true);
        return;
      }

      // Whenever new fire/trouble/supervisory, acknowledged, or other reset log arrives:
      // Run `show counts` command once and update totalFire/Trouble/Supervisory in UI & DB realtime
      if (isFire || isTrouble || isSupervisory || isAck || isReset) {
        requestCountsCheck();
      }
    };

    // ── Live message batching ────────────────────────────────────────────────
    // New panel messages are looked at together — up to LIVE_BATCH_MAX (10) of
    // them, for at most LIVE_BATCH_WINDOW_MS (2 s) — then handled one at a time
    // (each finishes before the next starts, so list writes never overwrite each
    // other) in priority order: fire → supervisory → trouble → everything else
    // (acks, restores, resets) in arrival order. The batch is handled early when
    // it is full, when 5+ are waiting and the stream pauses, or LIVE_FIRE_GRACE_MS
    // after a fire (so the fire alert is never held back by the window).
    // `show counts` runs once per batch.
    let pendingEntries = [];
    let batchTimer = null;
    let quietTimer = null;
    let fireTimer = null;
    let batchSeq = 0;
    let processingChain = Promise.resolve();
    let countsCheck = null;

    const requestCountsCheck = (checkDecrease = false) => {
      countsCheck = { checkDecrease: Boolean(countsCheck?.checkDecrease || checkDecrease) };
    };

    const clearBatchTimers = () => {
      for (const timer of [batchTimer, quietTimer, fireTimer]) {
        if (timer) clearTimeout(timer);
      }
      batchTimer = null;
      quietTimer = null;
      fireTimer = null;
    };

    const flushBatch = () => {
      clearBatchTimers();
      if (pendingEntries.length === 0) return;
      const batch = pendingEntries.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      pendingEntries = [];

      processingChain = processingChain.then(async () => {
        for (const { entry } of batch) {
          if (!active) return;
          try {
            await processEntry(entry);
          } catch (error) {
            console.error("[FireModalContext] live message failed:", error);
          }
        }
        if (countsCheck && active) {
          const options = countsCheck;
          countsCheck = null;
          // Not awaited: a full list t can take tens of seconds and must not
          // hold back the next batch (e.g. a new fire).
          void fetchAndSyncCounts(options);
        }
      });
    };

    const enqueueEntry = (entry) => {
      // AutoPilot hook: "ACCESS GRANTED" (login reply) seen in the panel logs.
      if (entry?.kind === "system" && entry.systemType === "login-success") {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("vision365:panelLoginGranted", { detail: { receivedAt: Date.now() } }),
          );
        }
        return;
      }
      const classified = classifyLiveEntry(entry);
      if (!classified) return;
      // Hold trouble / supervisory work from the moment a fire line arrives —
      // before this batch runs and before `show counts` confirms the fire.
      if (classified.isFire && !classified.isAck) noteLiveFireAlarm();
      const receivedAt = Date.now();
      receivedAtByEntry.set(entry, receivedAt);
      announceLivePanelEntry(entry, classified, receivedAt);
      const priority = liveEntryPriority(classified);
      pendingEntries.push({ entry, priority, seq: batchSeq++ });

      if (pendingEntries.length >= LIVE_BATCH_MAX) {
        flushBatch();
        return;
      }
      if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, LIVE_BATCH_WINDOW_MS);
      }
      if (priority === LIVE_PRIORITY.fire && !fireTimer) {
        fireTimer = setTimeout(flushBatch, LIVE_FIRE_GRACE_MS);
      }
      if (pendingEntries.length >= LIVE_BATCH_MIN_LOOKAHEAD) {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(flushBatch, LIVE_BATCH_QUIET_MS);
      }
    };

    const connectLiveAlarms = () => {
      try {
        const streamUrl = typeof window !== "undefined"
          ? apiUrl("/api/telnet/fire-panel/logs/stream")
          : "/api/telnet/fire-panel/logs/stream";
        eventSource = new EventSource(streamUrl);

        eventSource.onmessage = (event) => {
          if (!active) return;
          try {
            const data = JSON.parse(event.data);
            // Skip backlog entries sent on initial connect — only react to live events
            if (data.backlog) return;
            // New format: entry is the root object with a `kind` field
            if (data.kind) {
              enqueueEntry(data);
            } else if (data.type === "log" && data.entry) {
              // Legacy format fallback
              enqueueEntry(data.entry);
            }
          } catch {
            // ignore malformed frame
          }
        };

        eventSource.onerror = () => {
          if (!active) return;
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          reconnectTimer = setTimeout(connectLiveAlarms, 3000);
        };
      } catch {
        reconnectTimer = setTimeout(connectLiveAlarms, 3000);
      }
    };

    connectLiveAlarms();

    const handleFireEvent = (e) => {
      if (e?.detail) {
        enqueueEntry(e.detail);
      }
    };
    if (typeof window !== "undefined") {
      window.addEventListener("vision365:newFireEvent", handleFireEvent);
    }

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      clearBatchTimers();
      if (eventSource) eventSource.close();
      if (typeof window !== "undefined") {
        window.removeEventListener("vision365:newFireEvent", handleFireEvent);
      }
    };
  }, [clearFireAckPending, fetchAndSyncCounts, hideFireAlert, showFireAlert]);

  const value = useMemo(
    () => ({
      isFireAlertOpen,
      isAlarmActive,
      isSirenMuted,
      showFireAlert,
      hideFireAlert,
      closeFireAlertModal,
      toggleSirenMute,
      muteSiren,
      unmuteSiren,
      activeAlarmInfo,
      runPostAckListSync,
      autoAcknowledgeFire,
      isFireAckPending,
      clearFireAckPending,
      isTroubleAckPending,
      clearTroubleAckPending,
      isSupervisoryAckPending,
      clearSupervisoryAckPending,
    }),
    [
      isFireAlertOpen,
      isAlarmActive,
      isSirenMuted,
      showFireAlert,
      hideFireAlert,
      closeFireAlertModal,
      toggleSirenMute,
      muteSiren,
      unmuteSiren,
      activeAlarmInfo,
      runPostAckListSync,
      autoAcknowledgeFire,
      isFireAckPending,
      clearFireAckPending,
      isTroubleAckPending,
      clearTroubleAckPending,
      isSupervisoryAckPending,
      clearSupervisoryAckPending,
    ],
  );

  return (
    <FireAlertContext.Provider value={value}>
      {children}
      <FireAlertModalView
        open={isFireAlertOpen}
        alarmInfo={activeAlarmInfo}
        isMuted={isSirenMuted}
        ackLoading={ackLoading}
        onToggleMute={toggleSirenMute}
        onAcknowledge={() => void handleAcknowledge()}
        onClose={closeFireAlertModal}
      />
    </FireAlertContext.Provider>
  );
}
