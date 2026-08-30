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
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/apiClient";
import { parseShowCountsResponse } from "@/lib/panelState";
import {
  handleSystemResetCompleteWorkflow,
  syncFireListAssets,
  syncTroubleListAssets,
  syncSupervisoryListAssets,
  resetCategorySimplexStatus,
} from "@/lib/systemResetWorkflow";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { appendLiveLogToCategoryList, saveListToCategoryDb } from "@/lib/recordAlarmHistory";
import { findAllDeviceAddressesByLocationText } from "@/lib/assetAddressFloorIndex";
import {
  LIST_COMMAND_TIMEOUT_MS,
  getListCmdForLabel,
  parsePanelListResponse,
  extractPanelDeviceAddresses,
  simplexKeyForCategoryLabel,
} from "@/lib/firePanelMonitor";
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import {
  withMonitorPaused,
  openPriorityGate,
  closePriorityGate,
} from "@/lib/firePanelMonitorSession";

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
              className="min-w-[140px] h-10 font-semibold shadow-md"
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

export function FireAlertProvider({ children }) {
  const router = useRouter();
  const { toast } = useToast();
  const [isFireAlertOpen, setIsFireAlertOpen] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isSirenMuted, setIsSirenMuted] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);
  const [activeAlarmInfo, setActiveAlarmInfo] = useState(null);
  const stopSirenRef = useRef(null);
  // Set per-category when a new message's location text resolves to more
  // than one AssetsList device — resolved with a `list f/t/s` dump once
  // that category's acknowledge succeeds (see runPostAckListSync).
  const ambiguousLocationRef = useRef({ Fire: false, Trouble: false, Supervisory: false });
  // Last known counts from any "show counts" call — used by the "NORMAL ACKED"
  // handler to detect a per-category decrease (see fetchAndSyncCounts).
  const previousCountsRef = useRef({ totalFire: 0, totalTrouble: 0, totalSupervisory: 0 });

  const showFireAlert = useCallback((alarmInfo = null) => {
    if (alarmInfo) {
      setActiveAlarmInfo(alarmInfo);
    }
    setAckLoading(false);
    setIsAlarmActive(true);
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

  const toggleSirenMute = useCallback(() => {
    setIsSirenMuted((prev) => !prev);
  }, []);

  const muteSiren = useCallback(() => {
    setIsSirenMuted(true);
  }, []);

  const unmuteSiren = useCallback(() => {
    setIsSirenMuted(false);
  }, []);

  const fetchAndSyncCounts = useCallback(async ({ checkDecrease = false } = {}) => {
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

      // 3. Only when explicitly asked (the "NORMAL ACKED" handler): if a
      // category's total decreased since the last known counts, something
      // cleared off-panel — hard-reset that category's F/T/S flags and list,
      // then re-list from the panel. No list command otherwise.
      if (checkDecrease) {
        const previous = previousCountsRef.current;
        if (counts.totalFire < previous.totalFire) {
          await resetCategorySimplexStatus("Fire");
          await syncFireListAssets();
        }
        if (counts.totalTrouble < previous.totalTrouble) {
          await resetCategorySimplexStatus("Trouble");
          await syncTroubleListAssets();
        }
        if (counts.totalSupervisory < previous.totalSupervisory) {
          await resetCategorySimplexStatus("Supervisory");
          await syncSupervisoryListAssets();
        }
      }

      previousCountsRef.current = {
        totalFire: counts.totalFire,
        totalTrouble: counts.totalTrouble,
        totalSupervisory: counts.totalSupervisory,
      };
    } catch (err) {
      console.error("[FireModalContext] fetchAndSyncCounts failed:", err);
    }
  }, []);

  /**
   * Runs only when a message in this category had an ambiguous (multi-device)
   * location AND that category's acknowledge just succeeded. Sends `list f/t/s`,
   * waits for the full response, saves it to {label}-list so the live page
   * (which reads that doc via onSnapshot) picks it up, and logs the response.
   *
   * Ack/silence/reset/etc. issued while this runs are held behind it (see
   * openPriorityGate) instead of preempting it — same-command retries coalesce.
   */
  const runPostAckListSync = useCallback(async (label) => {
    if (!ambiguousLocationRef.current[label]) return;
    ambiguousLocationRef.current[label] = false;

    const listCmd = getListCmdForLabel(label);
    if (!listCmd) return;

    const gate = openPriorityGate();
    try {
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
    } finally {
      closePriorityGate(gate);
    }
  }, []);

  const handleAcknowledge = useCallback(() => {
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
    router.push(LIVE_FIRE_ROUTE);

    // Run `ack f` and count sync non-blockingly in background. No unconditional
    // `list f` here — only run one afterward if a fire message this alarm had
    // an ambiguous (multi-device) location, and only once ack has succeeded.
    void (async () => {
      let ackSucceeded = false;
      try {
        await sendPriorityPanelCommand("ack", 2000);
        ackSucceeded = true;
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
  }, [closeFireAlertModal, fetchAndSyncCounts, muteSiren, router, runPostAckListSync, toast]);

  // Siren runs while alarm is active (even after modal is closed)
  useEffect(() => {
    if (!isAlarmActive || isSirenMuted) {
      stopSirenRef.current?.();
      stopSirenRef.current = null;
      return;
    }

    stopSirenRef.current = startFireAlertSiren();

    return () => {
      stopSirenRef.current?.();
      stopSirenRef.current = null;
    };
  }, [isAlarmActive, isSirenMuted]);

  // ── Realtime SSE listener: trigger modal whenever a new fire alarm arrives ──
  useEffect(() => {
    let active = true;
    let eventSource = null;
    let reconnectTimer = null;

    const processEntry = (entry) => {
      if (!entry) return;

      // Ignore list query responses, non-alarm system/diagnostic/noise/unparsed lines
      if (
        entry.isListEntry ||
        Boolean(entry.pointId) ||
        entry.kind === "system" ||
        entry.kind === "cval" ||
        entry.kind === "noise" ||
        entry.kind === "unparsed"
      ) {
        return;
      }

      const rawText = String(entry.raw || "");
      if (
        /show\s+counts|FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+/i.test(
          rawText,
        )
      ) {
        return;
      }

      const statusText = String(entry.status || "");
      const catText = String(entry.category || "");

      // Check if this is an explicit fire alarm event (live event, not a list item)
      const isFire =
        (entry.kind === "fire" ||
          catText === "fire" ||
          /^FIRE\s+ALARM$|^FIRE$/i.test(statusText)) &&
        !entry.isListEntry &&
        !entry.pointId;

      // Check if this is an ACK event
      const isAck =
        entry.kind === "fire-acknowledged" ||
        entry.kind === "acknowledged" ||
        entry.acknowledged === true ||
        /ACKED/i.test(statusText) ||
        statusText === "NORMAL ACKED" ||
        /NORMAL\s+ACKED|FIRE\s+ALARM\s+ACKED/i.test(rawText);

      // Check if event is trouble (live event, not a list item)
      const isTrouble =
        (entry.kind === "trouble" ||
          catText === "trouble" ||
          /TROUBLE|TRBL|DIRTY/i.test(statusText)) &&
        !entry.isListEntry &&
        !entry.pointId;

      // Check if event is supervisory (live event, not a list item)
      const isSupervisory =
        (entry.kind === "supervisory" ||
          catText === "supervisory" ||
          /SUPERVISORY|SUPV|SUPR/i.test(statusText) ||
          /SUPERVISORY/i.test(String(entry.device || ""))) &&
        !entry.isListEntry &&
        !entry.pointId;

      // Check if event is system reset
      const isReset =
        entry.kind === "reset-complete" ||
        entry.kind === "reset-normal" ||
        entry.kind === "reset-in-progress" ||
        entry.kind === "reset-aborted" ||
        entry.kind === "reset";

      // If new unacknowledged fire alarm detected -> popup fire modal & update device F value to 1!
      // No fire-list DB write here — the fire-list DB is only ever updated
      // from handleSystemResetCompleteWorkflow's reset-complete path now.
      if (isFire && !isAck) {
        const fireAddr =
          entry.pointId ||
          entry.deviceAddress ||
          rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] ||
          "";

        showFireAlert({
          location: entry.location || "Fire Alarm Detected",
          deviceType: entry.device || entry.deviceType || entry.description || "Fire Device",
          deviceAddress: fireAddr,
          panelTime: entry.time ? `${entry.time} ${entry.date || ""}`.trim() : entry.panelTime || "",
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
          entry.device || entry.deviceType || entry.description || "";
        void (async () => {
          try {
            const resolvedAddresses = await findAllDeviceAddressesByLocationText(fireLocation);
            if (resolvedAddresses.length > 1) {
              ambiguousLocationRef.current.Fire = true;
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
                console.log(
                  `[FireModalContext] fire-list saved from list f: ${parsedRows.length} row(s)`,
                );
              } catch (err) {
                console.error("[FireModalContext] list f failed:", err);
              }
            } else {
              const resolvedAddress = resolvedAddresses[0] || "";
              if (!resolvedAddress) return;
              console.log(fireLocation, fireDeviceType);
              const listFItem = [resolvedAddress, fireLocation, fireDeviceType, "FIRE*"]
                .filter(Boolean)
                .join("   ");
              console.log("[FireModalContext] new fire as list f item:", listFItem);
              const parsedRows = parsePanelListResponse(listFItem);
              await saveListToCategoryDb("Fire", parsedRows);
            }


          } catch (error) {
            console.error("[FireModalContext] findAllDeviceAddressesByLocationText failed:", error);
          }
        })();
      }

      // If new unacknowledged trouble log arrives -> append to trouble-list DB & update T value to 1
      if (isTrouble && !isAck) {
        const trblAddr =
          entry.pointId ||
          entry.deviceAddress ||
          rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] ||
          "";

        // LivePanelAlertProvider owns the trouble beep/modal but sits below this
        // provider in the tree, so signal it via a window event (same pattern as
        // vision365:firePanelStateUpdated) instead of calling its hook directly.
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("vision365:newTroubleEvent"));
        }

        void (async () => {
          if (trblAddr) {
            await appendLiveLogToCategoryList("Trouble", entry);
            // Optimistic single-device patch only — see Fire branch above for why
            // syncAssetsListWithPanelList cannot be called with just this one address.
            useAssetFireStatusStore.getState().optimisticallySetFlagForAddresses([trblAddr], "T", 1);
          }
          await syncTroubleListAssets();
        })();

        // Same ambiguous-location detection as Fire — resolved with a real
        // `list t` once this trouble alert is acknowledged.
        const troubleLocation = entry.location || "";
        void (async () => {
          try {
            const resolvedAddresses = await findAllDeviceAddressesByLocationText(troubleLocation);
            if (resolvedAddresses.length > 1) {
              ambiguousLocationRef.current.Trouble = true;
              console.log(
                "[FireModalContext] trouble location matches multiple devices — will re-list after ack:",
                troubleLocation,
                resolvedAddresses,
              );
            }
          } catch (error) {
            console.error("[FireModalContext] findAllDeviceAddressesByLocationText failed:", error);
          }
        })();
      }

      // If new unacknowledged supervisory log arrives -> append to supervisory-list DB & update S value to 1
      if (isSupervisory && !isAck) {
        const supAddr =
          entry.pointId ||
          entry.deviceAddress ||
          rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] ||
          "";

        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("vision365:newSupervisoryEvent"));
        }

        void (async () => {
          if (supAddr) {
            await appendLiveLogToCategoryList("Supervisory", entry);
            // Optimistic single-device patch only — see Fire branch above for why
            // syncAssetsListWithPanelList cannot be called with just this one address.
            useAssetFireStatusStore.getState().optimisticallySetFlagForAddresses([supAddr], "S", 1);
          }
          await syncSupervisoryListAssets();
        })();

        // Same ambiguous-location detection as Fire — resolved with a real
        // `list s` once this supervisory alert is acknowledged.
        const supervisoryLocation = entry.location || "";
        void (async () => {
          try {
            const resolvedAddresses = await findAllDeviceAddressesByLocationText(supervisoryLocation);
            if (resolvedAddresses.length > 1) {
              ambiguousLocationRef.current.Supervisory = true;
              console.log(
                "[FireModalContext] supervisory location matches multiple devices — will re-list after ack:",
                supervisoryLocation,
                resolvedAddresses,
              );
            }
          } catch (error) {
            console.error("[FireModalContext] findAllDeviceAddressesByLocationText failed:", error);
          }
        })();
      }

      // If system reset completed, dismiss active fire alert and run full post-reset reconciliation workflow
      if (entry.kind === "reset-complete" || /SYSTEM\s+RESET\s+COMPLETE/i.test(statusText)) {
        hideFireAlert();
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
        void fetchAndSyncCounts();
        return;
      }

      // If the panel reports "NORMAL ACKED": something was acknowledged/cleared
      // off-panel. Check show counts and, per category, if that category's
      // total decreased, hard-reset its F/T/S flags + list and re-list it.
      const isNormalAcked =
        statusText === "NORMAL ACKED" || /NORMAL\s+ACKED/i.test(rawText);

      if (isNormalAcked) {
        void fetchAndSyncCounts({ checkDecrease: true });
        return;
      }

      // Whenever new fire/trouble/supervisory, acknowledged, or other reset log arrives:
      // Run `show counts` command once and update totalFire/Trouble/Supervisory in UI & DB realtime
      if (isFire || isTrouble || isSupervisory || isAck || isReset) {
        void fetchAndSyncCounts();
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
              processEntry(data);
            } else if (data.type === "log" && data.entry) {
              // Legacy format fallback
              processEntry(data.entry);
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

    return () => {
      active = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (eventSource) eventSource.close();
    };
  }, [showFireAlert]);

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
