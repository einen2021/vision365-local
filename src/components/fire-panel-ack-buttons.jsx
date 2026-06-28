"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";

const ACK_BUTTONS = [
  {
    label: "Fire",
    title: "Fire Ack",
    variant: "destructive",
    cvalField: "totalFire",
    activeClassName: "border-red-500/40 bg-red-500/5",
  },
  {
    label: "Trouble",
    title: "Trouble Ack",
    variant: "outline",
    cvalField: "totalTrouble",
    activeClassName: "border-yellow-500/40 bg-yellow-500/5",
  },
  {
    label: "Supervisory",
    title: "Sup Ack",
    variant: "outline",
    cvalField: "totalSupervisory",
    activeClassName: "border-purple-500/40 bg-purple-500/5",
  },
];

/** Fire panel acknowledge commands for dashboard headers. */
export function FirePanelAckButtons() {
  const { acknowledge, firePanelState } = useFirePanelMonitor();
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
      {ACK_BUTTONS.map(({ label, title, variant, cvalField, activeClassName }) => {
        const cval = firePanelState?.[cvalField] ?? 0;
        const active = cval > 0;

        return (
          <Button
            key={label}
            type="button"
            variant={variant}
            size="sm"
            className={active && variant === "outline" ? activeClassName : undefined}
            disabled={!connected || loadingLabel !== null}
            onClick={() => handleAck(label, title)}
          >
            {loadingLabel === label ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                {title}
                <span
                  className={`ml-1 rounded px-1 font-mono text-[11px] font-semibold tabular-nums ${
                    active ? "" : "text-muted-foreground"
                  }`}
                >
                  {cval}
                </span>
              </>
            )}
          </Button>
        );
      })}
    </>
  );
}
