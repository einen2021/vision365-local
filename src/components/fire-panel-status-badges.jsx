"use client";

import { useState } from "react";
import { Loader2, Radio, RefreshCcw, Unplug, VolumeX, Wifi } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";
import { FirePanelAckButtons } from "@/components/fire-panel-ack-buttons";
import { GraphicsViewNavButton } from "@/components/graphics-view-nav-button";

/** Taller header controls — connection/monitoring badges stay compact. */
const HEADER_ACTION_BUTTON_CLASS = "h-10 px-4 text-sm";
const STATUS_BADGE_CLASS =
  "h-4 gap-0.5 px-1.5 py-0 text-[9px] leading-none [&>svg]:size-2.5";

/** Fire panel header actions shown on every dashboard page. */
export function FirePanelStatusBadges() {
  const { silenceAlarm, systemReset, firePanelMonitoring } = useFirePanelMonitor();
  const connected = useFirePanelStore((s) => s.connected);
  const loading = useFirePanelStore((s) => s.loading);
  const connectedHost = useFirePanelStore((s) => s.connectedHost);
  const connectedPort = useFirePanelStore((s) => s.connectedPort);
  const { toast } = useToast();
  const [silencing, setSilencing] = useState(false);
  const [isSystemResetting, setIsSystemResetting] = useState(false);
  const [systemResetDialogOpen, setSystemResetDialogOpen] = useState(false);

  const handleSilenceAlarm = async () => {
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before silencing alarms.",
        variant: "destructive",
      });
      return;
    }

    setSilencing(true);
    try {
      await silenceAlarm();
      toast({
        title: "Silence alarm sent",
        description: "Silence command sent to the fire panel.",
      });
    } catch (error) {
      toast({
        title: "Silence alarm failed",
        description: error?.message || "Could not silence panel alarms.",
        variant: "destructive",
      });
    } finally {
      setSilencing(false);
    }
  };

  const handleSystemReset = async () => {
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before running system reset.",
        variant: "destructive",
      });
      return;
    }

    setIsSystemResetting(true);
    try {
      await systemReset();
      setSystemResetDialogOpen(false);
      toast({
        title: "System reset successful",
        description:
          "Panel reset command completed. Asset statuses are being cleared in the background.",
      });
    } catch (error) {
      console.error("System reset failed:", error);
      toast({
        title: "System reset failed",
        description: error?.message || "Could not reset asset statuses.",
        variant: "destructive",
      });
    } finally {
      setIsSystemResetting(false);
    }
  };

  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
        <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-col gap-0.5">
          {connected ? (
            <Badge
              variant="outline"
              className={`${STATUS_BADGE_CLASS} border-green-600/40 text-green-600`}
              title={
                connectedHost
                  ? `Connected to ${connectedHost}:${connectedPort}`
                  : "Fire panel connected"
              }
            >
              <Wifi />
              Connected
            </Badge>
          ) : loading ? (
            <Badge
              variant="outline"
              className={`${STATUS_BADGE_CLASS} text-amber-600 border-amber-600/40`}
            >
              <Loader2 className="animate-spin" />
              Connecting
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className={`${STATUS_BADGE_CLASS} text-muted-foreground`}
            >
              <Unplug />
              Disconnected
            </Badge>
          )}

          {connected && firePanelMonitoring ? (
            <Badge
              variant="outline"
              className={`${STATUS_BADGE_CLASS} border-green-600/40 text-green-600`}
            >
              <Radio />
              Monitoring
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className={`${STATUS_BADGE_CLASS} text-muted-foreground`}
            >
              <Radio />
              Not Monitoring
            </Badge>
          )}
        </div>

        <FirePanelAckButtons />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={HEADER_ACTION_BUTTON_CLASS}
          disabled={!connected || silencing || isSystemResetting}
          onClick={() => void handleSilenceAlarm()}
        >
          {silencing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <VolumeX className="mr-2 h-4 w-4" />
          )}
          Silence Alarm
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={HEADER_ACTION_BUTTON_CLASS}
          onClick={() => setSystemResetDialogOpen(true)}
          disabled={!connected || isSystemResetting || silencing}
        >
          {isSystemResetting ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCcw className="mr-2 h-4 w-4" />
          )}
          System Reset
        </Button>
        </div>
        <GraphicsViewNavButton />
      </div>

      <AlertDialog open={systemResetDialogOpen} onOpenChange={setSystemResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>System reset</AlertDialogTitle>
            <AlertDialogDescription>
              This clears fire (F), trouble (T), and supervisory (S) status on every asset in
              AssetsList. Floor map markers will return to normal.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSystemResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSystemReset();
              }}
              disabled={!connected || isSystemResetting}
            >
              {isSystemResetting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Resetting…
                </>
              ) : (
                "Confirm reset"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
