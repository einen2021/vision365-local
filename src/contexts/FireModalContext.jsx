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
import { Flame, Loader2, Volume2, VolumeX, X } from "lucide-react";
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
import { withMonitorPausedForPriority } from "@/lib/firePanelMonitorSession";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";

const FireAlertContext = createContext();

export const useFireAlert = () => useContext(FireAlertContext);

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
          // Hide the default dialog X — we render our own so it works during ack.
          "[&>button]:hidden",
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          // Allow Escape to close even while acknowledging.
          e.preventDefault();
          onClose?.();
        }}
      >
        {/* Always-available close — works even while Acknowledge is in progress. */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-3 top-3 z-20 h-8 w-8 rounded-full text-white hover:bg-white/20 hover:text-white"
          onClick={onClose}
          aria-label="Close fire alert"
        >
          <X className="h-4 w-4" />
        </Button>

        <div className="relative overflow-hidden bg-gradient-to-br from-red-700 via-red-600 to-red-700 px-6 py-6 text-white">
          <div
            className="pointer-events-none absolute inset-0 opacity-30"
            aria-hidden
            style={{
              backgroundImage:
                "repeating-linear-gradient(-45deg, transparent, transparent 8px, rgba(255,255,255,0.08) 8px, rgba(255,255,255,0.08) 16px)",
            }}
          />
          <DialogHeader className="relative space-y-0 text-left pr-8">
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

        <div className="bg-background px-6 py-8 text-center">
          <p className="text-lg font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
            Emergency
          </p>
          <p className="mt-3 text-2xl font-bold leading-snug text-foreground sm:text-3xl">
            Fire condition detected on the panel.
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            Acknowledge to dismiss this alert and review the live fire list.
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
            <Button type="button" variant="secondary" onClick={onClose}>
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
  const [addressLoading, setAddressLoading] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);
  const [deviceList, setDeviceList] = useState([]);
  const stopSirenRef = useRef(null);
  // AppProvider registers list-f loader here so ack can run it before navigation.
  const onAfterFireAckRef = useRef(null);
  /** User closed the modal while ack was still running — skip auto-navigate. */
  const closedDuringAckRef = useRef(false);

  const setOnAfterFireAck = useCallback((fn) => {
    onAfterFireAckRef.current = typeof fn === "function" ? fn : null;
  }, []);

  const showFireAlert = useCallback(() => {
    setDeviceList([]);
    setAckLoading(false);
    setIsAlarmActive(true);
    setIsFireAlertOpen(true);
  }, []);

  const hideFireAlert = useCallback(() => {
    setIsFireAlertOpen(false);
    setIsAlarmActive(false);
    setIsSirenMuted(false);
    setAddressLoading(false);
    setAckLoading(false);
    setDeviceList([]);
  }, []);

  const closeFireAlertModal = useCallback(() => {
    // Always dismiss the dialog UI, even if ack is still in flight.
    setIsFireAlertOpen(false);
    setAckLoading(false);
  }, []);

  const handleCloseFireAlert = useCallback(() => {
    closedDuringAckRef.current = true;
    closeFireAlertModal();
  }, [closeFireAlertModal]);

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

    closedDuringAckRef.current = false;
    setAckLoading(true);
    try {
      // Send "ack f", then go to Live Fire (list f loads on that page).
      await withMonitorPausedForPriority(async () => {
        const result = await sendPanelCommand("ack f");
        if (!result?.ok) {
          throw new Error(
            useFirePanelStore.getState().lastError || "Acknowledge command failed",
          );
        }
      });

      // User closed while ack was in flight — leave them where they are.
      if (closedDuringAckRef.current) {
        return;
      }

      muteSiren();
      closeFireAlertModal();
      router.push(LIVE_FIRE_ROUTE);
    } catch (error) {
      if (closedDuringAckRef.current) return;
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
      addressLoading,
      deviceList,
      setAddressLoading,
      setDeviceList,
      muteSiren,
      unmuteSiren,
      setOnAfterFireAck,
    }),
    [
      isFireAlertOpen,
      isAlarmActive,
      isSirenMuted,
      showFireAlert,
      hideFireAlert,
      closeFireAlertModal,
      toggleSirenMute,
      addressLoading,
      deviceList,
      muteSiren,
      unmuteSiren,
      setOnAfterFireAck,
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
        onClose={handleCloseFireAlert}
      />
    </FireAlertContext.Provider>
  );
}
