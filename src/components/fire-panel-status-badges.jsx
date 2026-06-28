"use client";

import { useState } from "react";
import { Loader2, RefreshCcw, VolumeX } from "lucide-react";
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

/** Fire panel header actions shown on every dashboard page. */
export function FirePanelStatusBadges() {
  const { silenceAlarm, systemReset } = useFirePanelMonitor();
  const connected = useFirePanelStore((s) => s.connected);
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
    setIsSystemResetting(true);
    try {
      await systemReset();
      setSystemResetDialogOpen(false);
      toast({
        title: "System reset complete",
        description: "All asset fire (F) statuses were cleared in AssetsList.",
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
      <FirePanelAckButtons />
      <Button
        type="button"
        variant="outline"
        size="sm"
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
        onClick={() => setSystemResetDialogOpen(true)}
        disabled={isSystemResetting || silencing}
      >
        {isSystemResetting ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <RefreshCcw className="mr-2 h-4 w-4" />
        )}
        System Reset
      </Button>

      <AlertDialog open={systemResetDialogOpen} onOpenChange={setSystemResetDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>System reset</AlertDialogTitle>
            <AlertDialogDescription>
              This clears fire (F) status on every asset in AssetsList. Floor map markers will
              return to normal. Trouble and supervisory values are not changed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSystemResetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleSystemReset();
              }}
              disabled={isSystemResetting}
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
