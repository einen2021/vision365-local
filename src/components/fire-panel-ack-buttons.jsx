"use client";

import { usePathname, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFireAlert } from "@/contexts/FireModalContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { acknowledgeFireConfirmed } from "@/lib/confirmedFireAck";
import { acknowledgeAlertConfirmed } from "@/lib/confirmedAlertAck";
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
    blinkClassName: "fire-ack-blink",
  },
  {
    label: "Trouble",
    title: "Trouble Ack",
    variant: "outline",
    cvalField: "totalTrouble",
    activeClassName: "border-yellow-500/40 bg-yellow-500/5",
    blinkClassName: "trouble-ack-blink",
  },
  {
    label: "Supervisory",
    title: "Sup Ack",
    variant: "outline",
    cvalField: "totalSupervisory",
    activeClassName: "border-purple-500/40 bg-purple-500/5",
    blinkClassName: "supervisory-ack-blink",
  },
];

/** Fire panel acknowledge commands for dashboard headers. */
export function FirePanelAckButtons() {
  const router = useRouter();
  const pathname = normalizePathname(usePathname());
  const { firePanelState } = useFirePanelMonitor();
  const {
    muteSiren,
    isFireAckPending,
    clearFireAckPending,
    isTroubleAckPending,
    clearTroubleAckPending,
    isSupervisoryAckPending,
    clearSupervisoryAckPending,
  } = useFireAlert();
  const ackPendingByLabel = {
    Fire: isFireAckPending,
    Trouble: isTroubleAckPending,
    Supervisory: isSupervisoryAckPending,
  };
  const connected = useFirePanelStore((s) => s.connected);
  const { toast } = useToast();

  // Returns true when ack was sent successfully.
  const handleAck = async (label, title) => {
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before sending acknowledge commands.",
        variant: "destructive",
      });
      return false;
    }

    try {
      if (label === "Fire") {
        // One ack, confirmed by the panel worker ("- ack" executed). A second
        // bare `ack` would acknowledge another event (e.g. a trouble).
        const result = await acknowledgeFireConfirmed();
        if (!result.acknowledged) throw new Error(result.error || "The panel did not run the ack.");
        toast({ title: "Fire acknowledged" });
        return true;
      }
      // Sent once; the panel worker confirms it executed (echo "- ack").
      const result = await acknowledgeAlertConfirmed(label);
      toast({
        title: result.acknowledged ? `${label} acknowledged` : `${title} executed`,
      });
      return true;
    } catch (error) {
      toast({
        title: `${title} failed`,
        description: error?.message || "Could not send acknowledge command.",
        variant: "destructive",
      });
      return false;
    }
  };

  const handleButtonClick = (label, title) => {
    const route = LIVE_PANEL_ROUTE_BY_LABEL[label];

    // Trouble and supervisory share one beep loop — any Ack click silences
    // both, so the beep always stops (a new event starts it again).
    silenceTroubleAlertBeep();
    silenceSupervisoryAlertBeep();

    if (label === "Fire") {
      muteSiren?.();
      clearFireAckPending?.();
    }
    if (label === "Trouble") {
      clearTroubleAckPending?.();
    }
    if (label === "Supervisory") {
      clearSupervisoryAckPending?.();
    }

    void (async () => {
      // Run the ACK command (bare `ack`) and wait for OK response.
      // No list command is sent here — never run list commands while an ack
      // button is being clicked, to avoid overlapping requests on the panel
      // connection. The live list page refreshes on its own.
      const ok = await handleAck(label, title);
      if (!ok) return;

      if (route && pathname !== route) {
        router.push(route);
      }
    })();
  };

  return (
    <>
      {ACK_BUTTONS.map(({ label, title, variant, cvalField, activeClassName, blinkClassName }) => {
        // Show live panel CVAL totals (same as the status cards).
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
              ackPendingByLabel[label] && blinkClassName,
            )}
            disabled={!connected}
            title={
              onLivePage
                ? `${title} on this page`
                : label === "Trouble"
                  ? "Send ack t, then open Live Trouble"
                  : `Open ${title.replace(" Ack", "")} list page`
            }
            onClick={() => handleButtonClick(label, title)}
          >
            {title}
            <span
              className={`ml-1 rounded px-1 font-mono text-[11px] font-semibold tabular-nums ${
                active ? "" : "text-muted-foreground"
              }`}
            >
              {cval}
            </span>
          </Button>
        );
      })}
    </>
  );
}
