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
import { acknowledgeCategory } from "@/lib/acknowledgePanelDevice";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/apiClient";
import { parseShowCountsResponse } from "@/lib/panelState";
import { handleSystemResetCompleteWorkflow } from "@/lib/systemResetWorkflow";
import { syncAssetsListWithPanelList } from "@/lib/panelListAssetSync";
import { appendLiveLogToCategoryList } from "@/lib/recordAlarmHistory";

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
          "gap-0 overflow-hidden border-red-500/60 p-0 shadow-2xl shadow-red-950/40 sm:max-w-[540px]",
          "ring-2 ring-red-500/40 ring-offset-2 ring-offset-background",
          "[&>button]:hidden",
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-red-700 via-red-600 to-red-700 px-6 py-6 text-white">
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

        <div className="bg-background px-6 py-6 space-y-4">
          <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-bold uppercase tracking-wide">
                Live Alarm Notification
              </p>
              <p className="text-base font-semibold leading-snug text-foreground">
                A new fire alarm condition was detected on the panel stream.
              </p>
            </div>
          </div>

          {alarmInfo ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 space-y-2 text-left shadow-inner">
              {alarmInfo.location ? (
                <div className="flex items-start gap-2 text-foreground font-bold text-sm">
                  <MapPin className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
                  <span>{alarmInfo.location}</span>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2 text-xs font-mono text-muted-foreground pt-1.5 border-t border-red-500/20">
                {alarmInfo.deviceType ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-red-600 dark:text-red-400">
                    <Radio className="h-3 w-3" />
                    {alarmInfo.deviceType}
                  </span>
                ) : null}

                {alarmInfo.deviceAddress ? (
                  <span className="bg-red-500/20 text-red-700 dark:text-red-300 px-1.5 py-0.5 rounded font-bold">
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

          <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              variant="destructive"
              className="min-w-[140px] font-semibold"
              onClick={onAcknowledge}
              disabled={ackLoading}
            >
              {ackLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Acknowledging…
                </>
              ) : (
                "Acknowledge"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onToggleMute}
              disabled={ackLoading}
              aria-pressed={isMuted}
              aria-label={isMuted ? "Unmute alarm siren" : "Mute alarm siren"}
            >
              {isMuted ? (
                <>
                  <VolumeX className="h-4 w-4 mr-1" />
                  Unmute Siren
                </>
              ) : (
                <>
                  <Volume2 className="h-4 w-4 mr-1" />
                  Mute Siren
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
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
    } catch (err) {
      console.error("[FireModalContext] fetchAndSyncCounts failed:", err);
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

    // Run `ack f` and count sync non-blockingly in background.
    // No `list f` here — the fire-list category is kept in sync via the live
    // event stream (appendLiveLogToCategoryList), not a panel list command.
    void (async () => {
      try {
        await acknowledgeCategory("Fire");
      } catch (err) {
        console.error("[FireModalContext] ack f failed:", err);
      }
      try {
        await fetchAndSyncCounts();
      } catch (err) {
        console.error("[FireModalContext] fetchAndSyncCounts failed:", err);
      }
    })();
  }, [closeFireAlertModal, fetchAndSyncCounts, muteSiren, router, toast]);

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

      // If new unacknowledged fire alarm detected -> popup fire modal, append to fire-list, & update device F value to 1!
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

        void (async () => {
          // appendLiveLogToCategoryList resolves the address via
          // findDeviceAddressByLocationText (matching entry.location against
          // AssetsList) when the raw log line has none — no `list f` needed.
          const savedRow = await appendLiveLogToCategoryList("Fire", entry);
          const resolvedAddr = savedRow?.deviceAddress || fireAddr;
          if (resolvedAddr) {
            console.log(`[FireModalContext] Updating F value for fire device: ${resolvedAddr}`);
            await syncAssetsListWithPanelList("Fire", [resolvedAddr]);
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

        void (async () => {
          const savedRow = await appendLiveLogToCategoryList("Trouble", entry);
          const resolvedAddr = savedRow?.deviceAddress || trblAddr;
          if (resolvedAddr) {
            await syncAssetsListWithPanelList("Trouble", [resolvedAddr]);
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

        void (async () => {
          const savedRow = await appendLiveLogToCategoryList("Supervisory", entry);
          const resolvedAddr = savedRow?.deviceAddress || supAddr;
          if (resolvedAddr) {
            await syncAssetsListWithPanelList("Supervisory", [resolvedAddr]);
          }
        })();
      }

      // If system reset completed, dismiss active fire alert and run full post-reset reconciliation workflow
      if (entry.kind === "reset-complete" || /SYSTEM\s+RESET\s+COMPLETE/i.test(statusText)) {
        hideFireAlert();
        void handleSystemResetCompleteWorkflow();
        return;
      }

      // If fire acknowledged log arrives: run show counts once (no `list f` —
      // fire-list stays in sync via the live event stream, not a panel list command).
      const isFireAck =
        entry.kind === "fire-acknowledged" ||
        /FIRE\s+ALARM\s+ACKED/i.test(statusText) ||
        /FIRE\s+ALARM\s+ACKED/i.test(rawText);

      if (isFireAck) {
        void fetchAndSyncCounts();
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
