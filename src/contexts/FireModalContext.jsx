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
import { Flame, Loader2, Volume2, VolumeX } from "lucide-react";
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
import { buildPanelAckCommand } from "@/lib/firePanelMonitor";
import { withMonitorPausedForPriority } from "@/lib/firePanelMonitorSession";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";

const FireAlertContext = createContext();

export const useFireAlert = () => useContext(FireAlertContext);

/** Fire alert UI — acknowledge, mute siren, and close only. */
function FireAlertModalView({
  open,
  isMuted,
  ackLoading,
  onToggleMute,
  onAcknowledge,
  onClose,
}) {
  return (
    <Dialog open={open}>
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden border-red-500/60 p-0 shadow-2xl shadow-red-950/30 sm:max-w-[520px]",
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
                  <Flame className="h-7 w-7 animate-pulse" aria-hidden />
                </span>
              </div>
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-red-100">
                  Critical Alert
                </p>
                <DialogTitle className="text-2xl font-bold tracking-wide text-white">
                  FIRE ALARM
                </DialogTitle>
                <DialogDescription className="text-sm text-red-100/90">
                  Immediate action required — investigate now
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="bg-background px-6 py-8">
          <p className="text-lg font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
            Emergency
          </p>
          <p className="mt-2 text-xl font-bold leading-snug text-foreground sm:text-2xl">
            Fire condition detected on the panel.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              variant="destructive"
              className="min-w-[140px] font-semibold"
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
              aria-label={isMuted ? "Unmute alarm siren" : "Mute alarm siren"}
            >
              {isMuted ? (
                <>
                  <VolumeX className="h-4 w-4" />
                  Unmute Siren
                </>
              ) : (
                <>
                  <Volume2 className="h-4 w-4" />
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
  const sendPanelCommand = useFirePanelStore((s) => s.sendCommand);
  const [isFireAlertOpen, setIsFireAlertOpen] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isSirenMuted, setIsSirenMuted] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);
  const stopSirenRef = useRef(null);

  const showFireAlert = useCallback(() => {
    setAckLoading(false);
    setIsAlarmActive(true);
    setIsFireAlertOpen(true);
  }, []);

  const hideFireAlert = useCallback(() => {
    setIsFireAlertOpen(false);
    setIsAlarmActive(false);
    setIsSirenMuted(false);
    setAckLoading(false);
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

  const handleAcknowledge = useCallback(async () => {
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
      // 1) Block CVAL/list monitoring and serialize other UI commands.
      // 2) Worker preempts any in-flight list and jumps ack ahead of the queue.
      // 3) Then send ack f.
      const result = await withMonitorPausedForPriority(async () => {
        const cmd = buildPanelAckCommand("Fire");
        return sendPanelCommand(cmd);
      });

      if (!result?.ok) {
        throw new Error(useFirePanelStore.getState().lastError || "Acknowledge command failed");
      }

      muteSiren();
      closeFireAlertModal();
      router.push(LIVE_FIRE_ROUTE);
    } catch (error) {
      toast({
        title: "Acknowledge failed",
        description: error?.message || "Could not acknowledge the fire alarm.",
        variant: "destructive",
      });
    } finally {
      setAckLoading(false);
    }
  }, [closeFireAlertModal, muteSiren, router, sendPanelCommand, toast]);

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
    ],
  );

  return (
    <FireAlertContext.Provider value={value}>
      {children}
      <FireAlertModalView
        open={isFireAlertOpen}
        isMuted={isSirenMuted}
        ackLoading={ackLoading}
        onToggleMute={toggleSirenMute}
        onAcknowledge={() => void handleAcknowledge()}
        onClose={closeFireAlertModal}
      />
    </FireAlertContext.Provider>
  );
}
