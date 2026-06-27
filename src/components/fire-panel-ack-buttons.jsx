"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";

const ACK_BUTTONS = [
  { label: "Fire", title: "Fire Ack", variant: "destructive" },
  { label: "Trouble", title: "Trouble Ack", variant: "outline" },
  { label: "Supervisory", title: "Sup Ack", variant: "outline" },
];

/** Fire panel acknowledge commands for dashboard headers. */
export function FirePanelAckButtons() {
  const { acknowledge } = useFirePanelMonitor();
  const connected = useFirePanelStore((s) => s.connected);
  const { toast } = useToast();
  const [loadingLabel, setLoadingLabel] = useState(null);

  const handleAck = async (label, title) => {
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before sending acknowledge commands.",
        variant: "destructive",
      });
      return;
    }

    setLoadingLabel(label);
    try {
      await acknowledge(label);
      toast({
        title: `${title} sent`,
        description: "Acknowledge command sent to the fire panel.",
      });
    } catch (error) {
      toast({
        title: `${title} failed`,
        description: error?.message || "Could not send acknowledge command.",
        variant: "destructive",
      });
    } finally {
      setLoadingLabel(null);
    }
  };

  return (
    <>
      {ACK_BUTTONS.map(({ label, title, variant }) => (
        <Button
          key={label}
          type="button"
          variant={variant}
          size="sm"
          disabled={!connected || loadingLabel !== null}
          onClick={() => handleAck(label, title)}
        >
          {loadingLabel === label ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            title
          )}
        </Button>
      ))}
    </>
  );
}
