"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Circle,
  Clock,
  Loader2,
  XCircle,
} from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopBar } from "@/components/dashboard-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageAuth } from "@/hooks/usePageAuth";
import { cn } from "@/lib/utils";
import { AUTOPILOT_STEPS, useAutoPilotStore } from "@/stores/autoPilotStore";
import { AUTOPILOT_BUDGET_MS } from "@/components/autopilot-controller";

const LABEL_BADGE_CLASS = {
  Fire: "border-red-500/40 bg-red-500/10 text-red-500",
  Trouble: "border-yellow-500/40 bg-yellow-500/10 text-yellow-500",
  Supervisory: "border-purple-500/40 bg-purple-500/10 text-purple-400",
};

const OUTCOME_META = {
  completed: { label: "Completed", className: "text-green-500" },
  "completed-with-errors": { label: "Finished with problems", className: "text-amber-500" },
  stopped: { label: "Stopped", className: "text-red-500" },
  failed: { label: "Failed", className: "text-red-500" },
  skipped: { label: "Skipped", className: "text-muted-foreground" },
  preempted: { label: "Paused for a fire alarm", className: "text-amber-500" },
  superseded: { label: "Handled with the fire alarm", className: "text-muted-foreground" },
  cancelled: { label: "Cancelled", className: "text-muted-foreground" },
};

function formatSeconds(ms) {
  if (ms == null || Number.isNaN(Number(ms))) return "";
  return `${(Number(ms) / 1000).toFixed(1)}s`;
}

function StepIcon({ status }) {
  if (status === "done") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  if (status === "waiting") return <Clock className="h-4 w-4 text-muted-foreground" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  if (status === "failed") return <XCircle className="h-4 w-4 text-red-500" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40" />;
}

function RunSteps({ run }) {
  const steps = AUTOPILOT_STEPS.filter((s) => s.id !== "disable" || run.includesDisable);
  return (
    <ol className="space-y-2">
      {steps.map(({ id, label }) => {
        const step = run.steps?.[id] || {};
        return (
          <li key={id} className="flex items-start gap-2 text-sm">
            <span className="mt-0.5">
              <StepIcon status={step.status} />
            </span>
            <span className={cn("flex-1", !step.status && "text-muted-foreground")}>
              {label}
              {step.message ? (
                <span className="block text-xs text-muted-foreground">{step.message}</span>
              ) : null}
            </span>
            {step.at != null ? (
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {formatSeconds(step.at)}
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function ElapsedClock({ startedAt }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const ms = Math.max(0, now - startedAt);
  return (
    <span
      className={cn(
        "font-mono text-sm tabular-nums",
        ms > AUTOPILOT_BUDGET_MS ? "text-red-500" : "text-muted-foreground",
      )}
    >
      {formatSeconds(ms)}
    </span>
  );
}

export default function AutoPilotPage() {
  const { isReady } = usePageAuth({ redirectIfLoggedOut: true });
  const enabled = useAutoPilotStore((s) => s.enabled);
  const disableFireDevice = useAutoPilotStore((s) => s.disableFireDevice);
  const setEnabled = useAutoPilotStore((s) => s.setEnabled);
  const setDisableFireDevice = useAutoPilotStore((s) => s.setDisableFireDevice);
  const currentRun = useAutoPilotStore((s) => s.currentRun);
  const queue = useAutoPilotStore((s) => s.queue);
  const history = useAutoPilotStore((s) => s.history);
  const clearHistory = useAutoPilotStore((s) => s.clearHistory);

  if (!isReady) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <DashboardTopBar headerClassName="flex h-16 shrink-0 items-center gap-2 border-b px-4" />
          <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 md:p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40 w-full" />
          </main>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DashboardTopBar headerClassName="flex h-16 shrink-0 items-center gap-2 border-b px-4" />

        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-primary" />
            <div>
              <h1 className="text-2xl font-semibold">AutoPilot</h1>
              <p className="text-sm text-muted-foreground">
                Handles new alarms for you
              </p>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Settings</CardTitle>
              <CardDescription>
                Fire alarms are always handled first, then trouble, then supervisory.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div className="space-y-1">
                  <Label htmlFor="autopilot-enabled" className="cursor-pointer font-semibold">
                    Enable AutoPilot
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    When a new alarm comes in, AutoPilot acknowledges it, silences the
                    alarm and resets the panel for you — usually within about 10 seconds.
                  </p>
                </div>
                <Switch
                  id="autopilot-enabled"
                  checked={enabled}
                  onCheckedChange={setEnabled}
                />
              </div>

              <div className="flex items-start justify-between gap-4 rounded-md border p-3">
                <div className="space-y-1">
                  <Label htmlFor="autopilot-disable-device" className="cursor-pointer font-semibold">
                    Turn off the fire device afterwards
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    After a fire alarm is reset, also turn off the device that set it off.
                  </p>
                </div>
                <Switch
                  id="autopilot-disable-device"
                  checked={disableFireDevice}
                  onCheckedChange={setDisableFireDevice}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Current run</CardTitle>
              <Badge variant="outline" className={enabled ? "text-green-500" : "text-muted-foreground"}>
                {enabled ? "On" : "Off"}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              {currentRun ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className={LABEL_BADGE_CLASS[currentRun.label]}>
                      {currentRun.label}
                      {currentRun.count > 1 ? ` ×${currentRun.count}` : ""}
                    </Badge>
                    <span className="text-sm">
                      {currentRun.locations?.join(" · ") || "—"}
                    </span>
                    <span className="ml-auto">
                      <ElapsedClock startedAt={currentRun.startedAt} />
                    </span>
                  </div>
                  <RunSteps run={currentRun} />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {enabled ? "Waiting for new panel messages." : "AutoPilot is off."}
                </p>
              )}

              {queue.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
                  Queued:
                  {queue.map((item) => (
                    <Badge key={item.label} variant="outline" className={LABEL_BADGE_CLASS[item.label]}>
                      {item.label} ×{item.count}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Recent runs</CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={clearHistory}
                disabled={history.length === 0}
              >
                Clear
              </Button>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs yet.</p>
              ) : (
                <ul className="divide-y">
                  {history.map((run) => {
                    const outcome = OUTCOME_META[run.outcome] || { label: run.outcome, className: "" };
                    return (
                      <li key={run.id} className="space-y-2 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <Badge variant="outline" className={LABEL_BADGE_CLASS[run.label]}>
                            {run.label}
                            {run.count > 1 ? ` ×${run.count}` : ""}
                          </Badge>
                          <span className="text-muted-foreground">
                            {new Date(run.startedAt).toLocaleTimeString()}
                          </span>
                          <span>{run.locations?.join(" · ") || "—"}</span>
                          <span className={cn("ml-auto font-medium", outcome.className)}>
                            {outcome.label}
                          </span>
                          {run.totalMs != null ? (
                            <span
                              className={cn(
                                "font-mono text-xs tabular-nums",
                                run.withinBudget === false ? "text-red-500" : "text-muted-foreground",
                              )}
                              title="Time from alarm to reset"
                            >
                              {formatSeconds(run.totalMs)}
                            </span>
                          ) : null}
                        </div>
                        {run.message ? (
                          <p className="text-xs text-muted-foreground">{run.message}</p>
                        ) : null}
                        <RunSteps run={run} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
