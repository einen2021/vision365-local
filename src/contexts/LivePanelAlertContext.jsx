"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, Eye, Loader2, Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LIVE_PANEL_ROUTE_BY_LABEL } from "@/config/live-panel-routes";
import { apiFetch, parseApiJsonResponse } from "@/lib/apiClient";
import { buildPanelAckCommand } from "@/lib/firePanelMonitor";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";
import {
  resetSupervisoryAlertSilence,
  resetTroubleAlertSilence,
  silenceSupervisoryAlertBeep,
  silenceTroubleAlertBeep,
  startSupervisoryAlertBeep,
  startTroubleAlertBeep,
  stopSupervisoryAlertBeep,
  stopTroubleAlertBeep,
} from "@/lib/troubleAlertBeep";
import { usePanelAlertSettingsStore } from "@/stores/panelAlertSettingsStore";
import { useFireAlert } from "@/contexts/FireModalContext";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const LivePanelAlertContext = createContext(null);

export const useLivePanelAlert = () => {
  const ctx = useContext(LivePanelAlertContext);
  if (!ctx) {
    throw new Error("useLivePanelAlert must be used within LivePanelAlertProvider");
  }
  return ctx;
};

const ALERT_CONFIG = {
  Trouble: {
    title: "TROUBLE ALARM",
    badge: "Trouble Alert",
    headline: "New trouble detected on the panel.",
    description: "Acknowledge to dismiss this alert and review the live trouble list.",
    icon: AlertTriangle,
    headerClass:
      "bg-gradient-to-br from-yellow-600 via-yellow-500 to-amber-600 text-yellow-950",
    accentClass: "text-yellow-700 dark:text-yellow-300",
    borderClass: "border-yellow-500/60 ring-yellow-500/40 shadow-yellow-950/20",
  },
  Supervisory: {
    title: "SUPERVISORY ALARM",
    badge: "Supervisory Alert",
    headline: "New supervisory condition detected on the panel.",
    description: "Acknowledge to dismiss this alert and review the live supervisory list.",
    icon: Eye,
    headerClass:
      "bg-gradient-to-br from-violet-700 via-violet-600 to-purple-700 text-white",
    accentClass: "text-violet-700 dark:text-violet-300",
    borderClass: "border-violet-500/60 ring-violet-500/40 shadow-violet-950/20",
  },
};

function LivePanelAlertModalView({
  label,
  open,
  isMuted,
  ackLoading,
  alertEnabled,
  onToggleAlertEnabled,
  onToggleMute,
  onAcknowledge,
}) {
  if (!label) return null;

  const config = ALERT_CONFIG[label];
  const Icon = config.icon;

  return (
    <Dialog open={open}>
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden p-0 shadow-2xl sm:max-w-[500px]",
          "ring-2 ring-offset-2 ring-offset-background",
          config.borderClass,
          "[&>button]:hidden",
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className={cn("relative overflow-hidden px-6 py-5", config.headerClass)}>
          <DialogHeader className="relative space-y-0 text-left">
            <div className="flex items-center gap-4">
              <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                <span className="absolute inset-0 animate-ping rounded-full bg-white/20" />
                <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/40">
                  <Icon className="h-7 w-7 animate-pulse" aria-hidden />
                </span>
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] opacity-90">
                  {config.badge}
                </p>
                <DialogTitle className="text-2xl font-bold tracking-wide">
                  {config.title}
                </DialogTitle>
                <DialogDescription className="text-sm opacity-90">
                  Review and acknowledge the newest active entry
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="bg-background px-6 py-8 text-center">
          <p className={cn("text-lg font-bold uppercase tracking-wide", config.accentClass)}>
            Attention Required
          </p>
          <p className="mt-3 text-2xl font-bold leading-snug text-foreground sm:text-3xl">
            {config.headline}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{config.description}</p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              className={cn(
                "min-w-[140px] font-semibold",
                label === "Trouble"
                  ? "bg-yellow-600 text-yellow-950 hover:bg-yellow-500"
                  : "bg-violet-600 text-white hover:bg-violet-500",
              )}
              onClick={onAcknowledge}
              disabled={ackLoading}
            >
              {ackLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
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
              aria-label={isMuted ? "Unmute alert beep" : "Mute alert beep"}
            >
              {isMuted ? (
                <>
                  <VolumeX className="h-4 w-4" />
                  Unmute Beep
                </>
              ) : (
                <>
                  <Volume2 className="h-4 w-4" />
                  Mute Beep
                </>
              )}
            </Button>
          </div>

          <div className="mt-5 flex items-center justify-center gap-2 border-t pt-4">
            <Switch
              id={`${label}-alert-enabled`}
              checked={alertEnabled}
              onCheckedChange={onToggleAlertEnabled}
              disabled={ackLoading}
            />
            <Label
              htmlFor={`${label}-alert-enabled`}
              className="cursor-pointer text-xs text-muted-foreground"
            >
              Show popup when new {label.toLowerCase()} alarms occur
            </Label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function LivePanelAlertProvider({ children }) {
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const { isAlarmActive } = useFireAlert();
  const troubleModalEnabled = usePanelAlertSettingsStore((s) => s.troubleModalEnabled);
  const supervisoryModalEnabled = usePanelAlertSettingsStore(
    (s) => s.supervisoryModalEnabled,
  );
  const setTroubleModalEnabled = usePanelAlertSettingsStore(
    (s) => s.setTroubleModalEnabled,
  );
  const setSupervisoryModalEnabled = usePanelAlertSettingsStore(
    (s) => s.setSupervisoryModalEnabled,
  );
  const [openLabel, setOpenLabel] = useState(null);
  const [isMuted, setIsMuted] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);

  const closeAlert = useCallback(() => {
    setOpenLabel(null);
    setIsMuted(false);
    setAckLoading(false);
  }, []);

  const dismissForFirePriority = useCallback(() => {
    stopTroubleAlertBeep();
    stopSupervisoryAlertBeep();
    setOpenLabel((current) =>
      current === "Trouble" || current === "Supervisory" ? null : current,
    );
    setIsMuted(false);
    setAckLoading(false);
  }, []);

  const showTroubleAlert = useCallback(() => {
    if (!usePanelAlertSettingsStore.getState().isTroubleModalEnabled()) return;
    if (isAlarmActive) return;
    resetTroubleAlertSilence();
    startTroubleAlertBeep();
    setIsMuted(false);
    setOpenLabel("Trouble");
  }, [isAlarmActive]);

  const showSupervisoryAlert = useCallback(() => {
    if (!usePanelAlertSettingsStore.getState().isSupervisoryModalEnabled()) return;
    if (isAlarmActive) return;
    resetSupervisoryAlertSilence();
    startSupervisoryAlertBeep();
    setIsMuted(false);
    setOpenLabel("Supervisory");
  }, [isAlarmActive]);

  /** Fire alarm takes priority — hide trouble / supervisory popups while fire is active. */
  useEffect(() => {
    if (isAlarmActive) {
      dismissForFirePriority();
    }
  }, [dismissForFirePriority, isAlarmActive]);

  const handleTroubleCountChange = useCallback((count) => {
    if (count === 0) {
      stopTroubleAlertBeep();
      resetTroubleAlertSilence();
      setOpenLabel((current) => (current === "Trouble" ? null : current));
    }
  }, []);

  const handleSupervisoryCountChange = useCallback((count) => {
    if (count === 0) {
      stopSupervisoryAlertBeep();
      resetSupervisoryAlertSilence();
      setOpenLabel((current) => (current === "Supervisory" ? null : current));
    }
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      if (openLabel === "Trouble") {
        if (next) silenceTroubleAlertBeep();
        else {
          resetTroubleAlertSilence();
          startTroubleAlertBeep();
        }
      } else if (openLabel === "Supervisory") {
        if (next) silenceSupervisoryAlertBeep();
        else {
          resetSupervisoryAlertSilence();
          startSupervisoryAlertBeep();
        }
      }
      return next;
    });
  }, [openLabel]);

  const handleAcknowledge = useCallback(async () => {
    if (!openLabel) return;

    const connected = useFirePanelStore.getState().connected;
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before acknowledging.",
        variant: "destructive",
      });
      return;
    }

    setAckLoading(true);
    try {
      const cmd = buildPanelAckCommand(openLabel);
      const res = await apiFetch("/api/telnet/fire-panel/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: cmd }),
      });
      const data = await parseApiJsonResponse(res);
      if (!res.ok) {
        throw new Error(data?.error || "Could not send acknowledge command.");
      }

      if (openLabel === "Trouble") {
        silenceTroubleAlertBeep();
      } else if (openLabel === "Supervisory") {
        silenceSupervisoryAlertBeep();
      }

      closeAlert();
    } catch (error) {
      toast({
        title: "Acknowledge failed",
        description: error?.message || "Could not acknowledge the panel alert.",
        variant: "destructive",
      });
    } finally {
      setAckLoading(false);
    }
  }, [closeAlert, openLabel, toast]);

  useEffect(() => {
    if (!openLabel) return;

    const route = LIVE_PANEL_ROUTE_BY_LABEL[openLabel];
    if (!route || pathname === route) return;

    router.push(route);
  }, [openLabel, pathname, router]);

  const value = useMemo(
    () => ({
      showTroubleAlert,
      showSupervisoryAlert,
      closeAlert,
      handleTroubleCountChange,
      handleSupervisoryCountChange,
      silenceTroubleAlertBeep,
      silenceSupervisoryAlertBeep,
      troubleModalEnabled,
      supervisoryModalEnabled,
      setTroubleModalEnabled,
      setSupervisoryModalEnabled,
    }),
    [
      showTroubleAlert,
      showSupervisoryAlert,
      closeAlert,
      handleTroubleCountChange,
      handleSupervisoryCountChange,
      troubleModalEnabled,
      supervisoryModalEnabled,
      setTroubleModalEnabled,
      setSupervisoryModalEnabled,
    ],
  );

  const alertEnabled =
    openLabel === "Trouble"
      ? troubleModalEnabled
      : openLabel === "Supervisory"
        ? supervisoryModalEnabled
        : true;

  const handleToggleAlertEnabled = useCallback(
    (enabled) => {
      if (openLabel === "Trouble") {
        setTroubleModalEnabled(enabled);
        if (!enabled) {
          silenceTroubleAlertBeep();
          closeAlert();
        }
      } else if (openLabel === "Supervisory") {
        setSupervisoryModalEnabled(enabled);
        if (!enabled) {
          silenceSupervisoryAlertBeep();
          closeAlert();
        }
      }
    },
    [closeAlert, openLabel, setSupervisoryModalEnabled, setTroubleModalEnabled],
  );

  return (
    <LivePanelAlertContext.Provider value={value}>
      {children}
      <LivePanelAlertModalView
        label={openLabel}
        open={Boolean(openLabel)}
        isMuted={isMuted}
        ackLoading={ackLoading}
        alertEnabled={alertEnabled}
        onToggleAlertEnabled={handleToggleAlertEnabled}
        onToggleMute={toggleMute}
        onAcknowledge={() => void handleAcknowledge()}
      />
    </LivePanelAlertContext.Provider>
  );
}
