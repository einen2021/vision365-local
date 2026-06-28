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
import { startFireAlertSiren } from "@/lib/fireAlertSiren";
import {
  buildFloorPlanViewUrl,
  getFireDeviceNavigationTarget,
} from "@/lib/fireAlertFloorNavigation";

const FireAlertContext = createContext();

export const useFireAlert = () => useContext(FireAlertContext);

function FireAlertModalView({ open, isMuted, onToggleMute, addressLoading }) {
  return (
    <Dialog open={open}>
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden border-red-500/60 p-0 shadow-2xl shadow-red-950/30 sm:max-w-[500px]",
          "ring-2 ring-red-500/40 ring-offset-2 ring-offset-background",
          "[&>button]:hidden",
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="relative overflow-hidden bg-gradient-to-br from-red-700 via-red-600 to-red-700 px-6 py-5 text-white">
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

        <div className="bg-background px-6 py-8 text-center">
          <p className="text-lg font-bold uppercase tracking-wide text-red-600 dark:text-red-400">
            Emergency
          </p>
          <p className="mt-3 text-2xl font-bold leading-snug text-foreground sm:text-3xl">
            There is fire in your building.
          </p>
          <p className="mt-2 text-lg font-semibold text-red-700 dark:text-red-300">
            Immediate action required.
          </p>

          <div className={cn("flex items-center px-5 w-full", addressLoading ? "justify-between" : "justify-center")}>
            {addressLoading ? (
              <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Locating alarm device…
              </div>
            ) : null}

            <Button
              type="button"
              variant="outline"
              className="mt-6"
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FireAlertProvider({ children }) {
  const router = useRouter();
  const [isFireAlertOpen, setIsFireAlertOpen] = useState(false);
  const [isAlarmActive, setIsAlarmActive] = useState(false);
  const [isSirenMuted, setIsSirenMuted] = useState(false);
  const [addressLoading, setAddressLoading] = useState(false);
  const [deviceList, setDeviceList] = useState([]);
  const stopSirenRef = useRef(null);
  const hasNavigatedRef = useRef(false);

  const showFireAlert = useCallback(() => {
    hasNavigatedRef.current = false;
    setDeviceList([]);
    setIsAlarmActive(true);
    setIsFireAlertOpen(true);
  }, []);

  const hideFireAlert = useCallback(() => {
    setIsFireAlertOpen(false);
    setIsAlarmActive(false);
    setIsSirenMuted(false);
    setAddressLoading(false);
    setDeviceList([]);
    hasNavigatedRef.current = false;
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

  // Navigate to the nested floor plan for the last resolved fire device, then close modal
  useEffect(() => {
    if (!isFireAlertOpen || addressLoading || deviceList.length === 0) return;
    if (hasNavigatedRef.current) return;

    const device = deviceList[deviceList.length - 1];
    const target = getFireDeviceNavigationTarget(device);
    if (!target) return;

    hasNavigatedRef.current = true;
    router.push(buildFloorPlanViewUrl(target));
    setIsFireAlertOpen(false);
  }, [isFireAlertOpen, addressLoading, deviceList, router]);

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
    ],
  );

  return (
    <FireAlertContext.Provider value={value}>
      {children}
      <FireAlertModalView
        open={isFireAlertOpen}
        isMuted={isSirenMuted}
        onToggleMute={toggleSirenMute}
        addressLoading={addressLoading}
      />
    </FireAlertContext.Provider>
  );
}
