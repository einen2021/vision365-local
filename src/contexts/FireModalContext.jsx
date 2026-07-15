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
import {
  Building2,
  Flame,
  Layers,
  Loader2,
  MapPin,
  Volume2,
  VolumeX,
} from "lucide-react";
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
import { buildFloorPlanViewUrl } from "@/lib/fireAlertFloorNavigation";
import { resolveAssetNavigationTarget } from "@/lib/assetPlacementNavigation";
import { buildGraphicsViewUrl } from "@/lib/graphicsViewSelection";
import { buildPanelAckCommand } from "@/lib/firePanelMonitor";
import {
  pauseMonitorLoop,
  resumeMonitorLoop,
} from "@/lib/firePanelMonitorSession";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

const FireAlertContext = createContext();

export const useFireAlert = () => useContext(FireAlertContext);

function getFloorPlacementLabel(target = {}) {
  const parts = [];
  if (target.floorName) parts.push(`Floor: ${target.floorName}`);
  if (target.sectionName) parts.push(`Section: ${target.sectionName}`);
  if (target.subsectionName) parts.push(`Subsection: ${target.subsectionName}`);
  return parts.join(" · ");
}

function getDeviceLabel(device) {
  const d = device && typeof device === "object" ? device : {};
  return (
    d.assetName ||
    d.name ||
    d.deviceType ||
    d.category ||
    "Fire alarm device"
  );
}

function getDeviceLocationLabel(device) {
  const d = device && typeof device === "object" ? device : {};
  return (
    d.deviceLocation ||
    d.deviceDescription ||
    d.description ||
    ""
  ).trim();
}

function FireAlertModalView({
  open,
  isMuted,
  addressLoading,
  placementResolving,
  ackLoading,
  device,
  navigationTarget,
  onToggleMute,
  onAcknowledge,
}) {
  const deviceAddress = device ? resolveAssetDeviceAddress(device) : "";
  const deviceLabel = device ? getDeviceLabel(device) : "";
  const locationLabel = device ? getDeviceLocationLabel(device) : "";
  const placementLabel = getFloorPlacementLabel(navigationTarget || {});
  const hasPlacement =
    Boolean(navigationTarget?.floorName) ||
    Boolean(navigationTarget?.sectionName) ||
    Boolean(navigationTarget?.subsectionName);
  // Only show the big "Locating…" spinner when we still have no device yet.
  // Placement can finish in the background without blocking Acknowledge.
  const isWaitingForDevice = !device && addressLoading;
  const isResolvingPlacement = Boolean(device) && placementResolving && !hasPlacement;

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

          {isWaitingForDevice ? (
            <div className="mt-5 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-3 text-sm text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              Locating alarm device…
            </div>
          ) : device ? (
            <dl className="mt-5 space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Building
                  </dt>
                  <dd className="font-medium">
                    {navigationTarget?.building || device.buildingName || device.building || "Unknown"}
                  </dd>
                </div>
              </div>

              {hasPlacement ? (
                <div className="flex items-start gap-3">
                  <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Floor Plan
                    </dt>
                    <dd className="font-medium">{placementLabel}</dd>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div>
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Floor Plan
                    </dt>
                    <dd className="text-muted-foreground">
                      {isResolvingPlacement ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          Resolving floor placement…
                        </span>
                      ) : (
                        "Device not placed on a nested floor map"
                      )}
                    </dd>
                  </div>
                </div>
              )}

              <div className="flex items-start gap-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Location
                  </dt>
                  <dd className="font-medium">
                    {locationLabel || "No location description"}
                  </dd>
                  {deviceAddress ? (
                    <dd className="font-mono text-xs text-muted-foreground">{deviceAddress}</dd>
                  ) : null}
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Flame className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Device
                  </dt>
                  <dd className="font-medium">{deviceLabel}</dd>
                </div>
              </div>
            </dl>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">
              Could not find device in AssetsList for this panel alarm.
            </p>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              type="button"
              variant="destructive"
              className="min-w-[140px] font-semibold"
              onClick={onAcknowledge}
              disabled={ackLoading || isWaitingForDevice}
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
  const [placementResolving, setPlacementResolving] = useState(false);
  const [ackLoading, setAckLoading] = useState(false);
  const [deviceList, setDeviceList] = useState([]);
  const [navigationTarget, setNavigationTarget] = useState(null);
  const stopSirenRef = useRef(null);

  const activeDevice = useMemo(() => {
    for (let i = deviceList.length - 1; i >= 0; i -= 1) {
      const item = deviceList[i];
      if (item && typeof item === "object") return item;
    }
    return null;
  }, [deviceList]);

  const showFireAlert = useCallback(() => {
    setDeviceList([]);
    setNavigationTarget(null);
    setPlacementResolving(false);
    setAckLoading(false);
    setIsAlarmActive(true);
    setIsFireAlertOpen(true);
  }, []);

  const hideFireAlert = useCallback(() => {
    setIsFireAlertOpen(false);
    setIsAlarmActive(false);
    setIsSirenMuted(false);
    setAddressLoading(false);
    setPlacementResolving(false);
    setAckLoading(false);
    setDeviceList([]);
    setNavigationTarget(null);
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

  // Resolve nested floor placement as soon as we have a device (don't wait for
  // the full list f / all-address lookup to finish).
  useEffect(() => {
    if (!activeDevice) return;

    let cancelled = false;
    setPlacementResolving(true);

    void (async () => {
      try {
        const target = await resolveAssetNavigationTarget(activeDevice, activeDevice.id);
        if (!cancelled) {
          setNavigationTarget(target);
        }
      } catch (error) {
        console.error("[fire-alert] placement resolve failed:", error);
        if (!cancelled) {
          setNavigationTarget(null);
        }
      } finally {
        if (!cancelled) {
          setPlacementResolving(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [activeDevice]);

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
    // Stop starting new list/CVAL cycles; send ack immediately so the worker
    // can preempt an in-flight list t dump (do not wait for the dump to finish).
    pauseMonitorLoop();
    try {
      const cmd = buildPanelAckCommand("Fire");
      const result = await sendPanelCommand(cmd);
      if (!result?.ok) {
        throw new Error(useFirePanelStore.getState().lastError || "Acknowledge command failed");
      }

      muteSiren();
      closeFireAlertModal();

      if (
        navigationTarget?.building &&
        navigationTarget.floorId &&
        navigationTarget.sectionId
      ) {
        router.push(buildFloorPlanViewUrl(navigationTarget));
      } else if (navigationTarget?.building || activeDevice?.buildingName || activeDevice?.building) {
        router.push(
          buildGraphicsViewUrl({
            building: navigationTarget?.building || activeDevice.buildingName || activeDevice.building,
          }),
        );
      }
    } catch (error) {
      toast({
        title: "Acknowledge failed",
        description: error?.message || "Could not acknowledge the fire alarm.",
        variant: "destructive",
      });
    } finally {
      resumeMonitorLoop();
      setAckLoading(false);
    }
  }, [
    activeDevice,
    closeFireAlertModal,
    muteSiren,
    navigationTarget,
    router,
    sendPanelCommand,
    toast,
  ]);

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
      navigationTarget,
      setAddressLoading,
      setDeviceList,
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
      addressLoading,
      deviceList,
      navigationTarget,
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
        addressLoading={addressLoading}
        placementResolving={placementResolving}
        ackLoading={ackLoading}
        device={activeDevice}
        navigationTarget={navigationTarget}
        onToggleMute={toggleSirenMute}
        onAcknowledge={() => void handleAcknowledge()}
      />
    </FireAlertContext.Provider>
  );
}
