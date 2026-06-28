"use client";

import {
  AlertTriangle,
  Building2,
  Clock,
  Flame,
  MapPin,
  VolumeX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Placeholder alarm details shown until real data is wired up. */
const PLACEHOLDER_ALERT = {
  building: "Tower A",
  zone: "Zone 3 — Level 12",
  device: "Photo Electric Smoke Sensor",
  location: "Corridor — East Wing",
  address: "L012-E-034",
  time: "Jun 27, 2026 · 14:32:08",
};

/** Global fire alert modal UI — open/close state lives in AppContext. */
export function FireAlertModal({ open, onClose }) {
  const alert = PLACEHOLDER_ALERT;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <DialogContent
        className={cn(
          "gap-0 overflow-hidden border-red-500/50 p-0 sm:max-w-[480px]",
          "[&>button]:text-red-100 [&>button]:hover:text-white",
        )}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <div className="bg-gradient-to-r from-red-700 to-red-600 px-6 py-5 text-white">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/15 ring-2 ring-white/30 animate-pulse">
                <Flame className="h-7 w-7" aria-hidden />
              </div>
              <div className="min-w-0 space-y-1">
                <DialogTitle className="text-xl font-bold tracking-wide text-white">
                  FIRE ALARM
                </DialogTitle>
                <DialogDescription className="text-sm text-red-100">
                  Immediate attention required
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
        </div>

        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-red-900 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
            <p className="text-sm font-medium leading-snug">
              Fire condition detected on the building fire alarm system.
            </p>
          </div>

          <dl className="space-y-3 text-sm">
            <div className="flex items-start gap-3">
              <Building2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Building
                </dt>
                <dd className="font-medium">{alert.building}</dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Location
                </dt>
                <dd className="font-medium">{alert.location}</dd>
                <dd className="text-muted-foreground">
                  {alert.zone} · {alert.address}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Flame className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Device
                </dt>
                <dd className="font-medium">{alert.device}</dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Time
                </dt>
                <dd className="font-medium tabular-nums">{alert.time}</dd>
              </div>
            </div>
          </dl>
        </div>

        <DialogFooter className="flex-col gap-2 border-t bg-muted/30 px-6 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button type="button" variant="outline" disabled>
            <MapPin className="h-4 w-4" />
            View on Map
          </Button>
          <Button type="button" variant="outline" disabled>
            <VolumeX className="h-4 w-4" />
            Silence Alarm
          </Button>
          <Button type="button" variant="destructive" disabled>
            Acknowledge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
