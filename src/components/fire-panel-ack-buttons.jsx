"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useToast } from "@/hooks/use-toast";
import { LIVE_PANEL_ROUTE_BY_LABEL } from "@/config/live-panel-routes";
import { normalizePathname } from "@/lib/roleAccess";
import {
  silenceSupervisoryAlertBeep,
  silenceTroubleAlertBeep,
} from "@/lib/troubleAlertBeep";

/** Taller header controls — status badges keep default compact height. */
const HEADER_ACTION_BUTTON_CLASS = "h-10 px-4 text-sm";

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
  const router = useRouter();
  const pathname = normalizePathname(usePathname());
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

  const handleButtonClick = (label, title) => {
    const route = LIVE_PANEL_ROUTE_BY_LABEL[label];
    if (route && pathname === route) {
      if (label === "Trouble") {
        silenceTroubleAlertBeep();
      }
      if (label === "Supervisory") {
        silenceSupervisoryAlertBeep();
      }
      void handleAck(label, title);
      return;
    }
    if (route) {
      router.push(route);
      return;
    }
    void handleAck(label, title);
  };

  return (
    <>
      {ACK_BUTTONS.map(({ label, title, variant, cvalField, activeClassName }) => {
        const cval = firePanelState?.[cvalField] ?? 0;
        const active = cval > 0;
        const onLivePage = pathname === LIVE_PANEL_ROUTE_BY_LABEL[label];

        return (
          <Button
            key={label}
            type="button"
            variant={variant}
            size="sm"
            className={cn(
              HEADER_ACTION_BUTTON_CLASS,
              active && variant === "outline" ? activeClassName : undefined,
            )}
            disabled={!connected || loadingLabel !== null}
            title={
              onLivePage
                ? `${title} on this page`
                : `Open ${title.replace(" Ack", "")} list page`
            }
            onClick={() => handleButtonClick(label, title)}
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
