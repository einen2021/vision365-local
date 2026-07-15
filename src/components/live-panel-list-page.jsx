"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, Flame, Loader2, RefreshCcw } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopBar } from "@/components/dashboard-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useToast } from "@/hooks/use-toast";
import {
  countListMessages,
  getExpectedListCountForLabel,
  isListResponseReady,
  parsePanelListResponse,
} from "@/lib/firePanelMonitor";
import {
  silenceSupervisoryAlertBeep,
  silenceTroubleAlertBeep,
} from "@/lib/troubleAlertBeep";
import { cn } from "@/lib/utils";
import { useLivePanelAlert } from "@/contexts/LivePanelAlertContext";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_BADGE_CLASSES = {
  TRBL: "border-yellow-500/50 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300",
  ALRM: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  FIRE: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  SUPV: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  SUPR: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  SUP: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300",
};

const PAGE_ICONS = {
  Fire: Flame,
  Trouble: AlertTriangle,
  Supervisory: Eye,
};

const TONE_CLASSES = {
  fire: "text-red-600",
  trouble: "text-yellow-700",
  supervisory: "text-purple-600",
};

const EMPTY_LABELS = {
  Fire: "No active fire alarms.",
  Trouble: "No active troubles.",
  Supervisory: "No active supervisory alarms.",
};

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

const ROW_HIGHLIGHT_CLASSES = {
  fire: "panel-row-highlight-fire",
  trouble: "panel-row-highlight-trouble",
  supervisory: "panel-row-highlight-supervisory",
};

function statusBadgeClass(status) {
  const key = String(status || "").replace(/\*$/, "").toUpperCase();
  return STATUS_BADGE_CLASSES[key] || "border-muted bg-muted/40 text-muted-foreground";
}

// Address | Location | Device type | Status
const LIST_GRID = "md:grid-cols-[140px_minmax(0,1fr)_150px_90px]";

function PanelAlarmList({
  rows,
  emptyLabel,
  pending = false,
  tone = "trouble",
  highlightedAddresses = new Set(),
  onRowAck,
  acknowledgingAddress = null,
  listComplete = true,
  expectedCount = null,
  listMessageCount = 0,
}) {
  const highlightClass = ROW_HIGHLIGHT_CLASSES[tone] || ROW_HIGHLIGHT_CLASSES.trouble;

  // Keep newly highlighted rows at the top of the list.
  const displayRows = useMemo(() => {
    if (!highlightedAddresses.size) return rows;

    const highlighted = rows.filter((row) => highlightedAddresses.has(row.fullAddress));
    const rest = rows.filter((row) => !highlightedAddresses.has(row.fullAddress));
    return [...highlighted, ...rest];
  }, [rows, highlightedAddresses]);

  if (!rows.length) {
    // Prefer "receiving…" over a false empty state while CVAL says points exist
    // or the panel list is still streaming.
    if (pending || (expectedCount != null && expectedCount > 0)) {
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
          <div
            className={cn(
              "hidden shrink-0 md:grid gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground",
              LIST_GRID,
            )}
          >
            <span>Address</span>
            <span>Location</span>
            <span>Device type</span>
            <span>Status</span>
          </div>
          <div className="flex flex-1 items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {expectedCount != null && expectedCount > 0
              ? `Receiving list — ${listMessageCount}/${expectedCount}`
              : "Receiving list from panel…"}
          </div>
        </div>
      );
    }

    return (
      <div className="py-10 text-center text-sm text-muted-foreground">{emptyLabel}</div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
      <div
        className={cn(
          "hidden shrink-0 md:grid gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground",
          LIST_GRID,
        )}
      >
        <span>Address</span>
        <span>Location</span>
        <span>Device type</span>
        <span>Status</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y">
          {displayRows.map((row, index) => {
            const isHighlighted = highlightedAddresses.has(row.fullAddress);
            const isAcknowledging = acknowledgingAddress === row.fullAddress;

            return (
              <li
                key={`${row.fullAddress}-${index}`}
                className={cn(
                  "px-4 py-3 transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200",
                  onRowAck && "cursor-pointer hover:bg-muted/40",
                  !onRowAck && "hover:bg-muted/30",
                  isHighlighted && highlightClass,
                  isAcknowledging && "opacity-60",
                )}
                onClick={onRowAck ? () => onRowAck(row) : undefined}
                onKeyDown={
                  onRowAck
                    ? (event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onRowAck(row);
                        }
                      }
                    : undefined
                }
                role={onRowAck ? "button" : undefined}
                tabIndex={onRowAck ? 0 : undefined}
                title={onRowAck ? "Click to acknowledge" : undefined}
              >
                <div className={cn("grid gap-2 md:items-center md:gap-3", LIST_GRID)}>
                  <div>
                    <p className="font-mono text-sm font-medium">{row.fullAddress}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground md:hidden">
                      {row.deviceType || "—"}
                    </p>
                  </div>

                  <p className="text-sm leading-snug break-words">{row.location || "—"}</p>

                  <p className="hidden text-sm text-muted-foreground md:block">
                    {row.deviceType || "—"}
                  </p>

                  <div>
                    {row.status ? (
                      <Badge
                        variant="outline"
                        className={cn("font-mono text-[11px]", statusBadgeClass(row.status))}
                      >
                        {row.status}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="shrink-0 border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
        {displayRows.length} active {displayRows.length === 1 ? "entry" : "entries"}
        {!listComplete ? (
          <span className="ml-2 text-amber-600 dark:text-amber-400">
            {expectedCount != null
              ? `(receiving — ${listMessageCount}/${expectedCount})`
              : "(receiving list from panel…)"}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Shared layout for live fire / trouble / supervisory list pages. */
export function LivePanelListPage({ label, title, description, tone }) {
  const { isReady } = usePageAuth({ redirectIfLoggedOut: true });
  const { toast } = useToast();
  const connected = useFirePanelStore((s) => s.connected);
  const {
    firePanelListResponses,
    firePanelState,
    fetchFirePanelListResponse,
    acknowledge,
  } = useFirePanelMonitor();

  const {
    troubleModalEnabled,
    supervisoryModalEnabled,
    setTroubleModalEnabled,
    setSupervisoryModalEnabled,
  } = useLivePanelAlert();

  const alertModalEnabled =
    label === "Trouble"
      ? troubleModalEnabled
      : label === "Supervisory"
        ? supervisoryModalEnabled
        : null;

  const handleAlertToggle = (enabled) => {
    if (label === "Trouble") setTroubleModalEnabled(enabled);
    if (label === "Supervisory") setSupervisoryModalEnabled(enabled);
  };

  const [acknowledgingAddress, setAcknowledgingAddress] = useState(null);
  const [ackedAddresses, setAckedAddresses] = useState(() => new Set());

  const Icon = PAGE_ICONS[label] || Flame;
  const cached = firePanelListResponses?.[label] ?? null;
  // Parse the raw panel list into table rows (address, location, type, status).
  const parsedRows = useMemo(
    () => (cached?.response ? parsePanelListResponse(cached.response) : []),
    [cached?.response],
  );
  const listVersion = cached?.fetchedAt ?? "empty";

  // Highlight the newest address from the last list parse (address appearance only).
  const highlightedAddresses = useMemo(() => {
    const newest = String(cached?.newestAddress || "").trim();
    return newest ? new Set([newest]) : new Set();
  }, [cached?.newestAddress, listVersion]);

  const isStreaming = Boolean(cached?.streaming);
  const expectedCount = getExpectedListCountForLabel(label, firePanelState);
  // Complete when ~CVAL messages arrived, _DNE, or stream finished with rows.
  const listComplete =
    !isStreaming &&
    (isListResponseReady(cached?.response || "", expectedCount) ||
      Boolean(cached?.response));
  const listMessageCount = cached?.response
    ? countListMessages(cached.response)
    : 0;

  const effectiveHighlightedAddresses = useMemo(() => {
    if (!ackedAddresses.size) return highlightedAddresses;

    const next = new Set(highlightedAddresses);
    for (const address of ackedAddresses) {
      next.delete(address);
    }
    return setsEqual(highlightedAddresses, next) ? highlightedAddresses : next;
  }, [ackedAddresses, highlightedAddresses]);

  const emptyLabel = EMPTY_LABELS[label] || "No active entries.";

  const rowKey = useMemo(
    () => parsedRows.map((row) => row.fullAddress).join("|"),
    [parsedRows],
  );

  useEffect(() => {
    const current = new Set(rowKey ? rowKey.split("|").filter(Boolean) : []);
    setAckedAddresses((prev) => {
      const next = new Set([...prev].filter((address) => current.has(address)));
      return next.size === prev.size ? prev : next;
    });
  }, [listVersion, rowKey]);

  const handleRowAck = useCallback(
    async (row) => {
      if (!connected || acknowledgingAddress) return;

      setAcknowledgingAddress(row.fullAddress);
      try {
        if (label === "Trouble") {
          silenceTroubleAlertBeep();
        }
        if (label === "Supervisory") {
          silenceSupervisoryAlertBeep();
        }

        await acknowledge(label, row.fullAddress);

        setAckedAddresses((prev) => {
          const next = new Set(prev);
          next.add(row.fullAddress);
          return next;
        });

        toast({
          title: "Acknowledged",
          description: row.fullAddress,
        });

        // Refresh list in the background — do not keep the row spinner on a full list dump.
        void fetchFirePanelListResponse(label).catch((error) => {
          console.error("[live-panel] post-ack list refresh failed:", error);
        });
      } catch (error) {
        toast({
          title: "Acknowledge failed",
          description: error?.message || "Could not acknowledge this entry.",
          variant: "destructive",
        });
      } finally {
        setAcknowledgingAddress(null);
      }
    },
    [
      acknowledge,
      acknowledgingAddress,
      connected,
      fetchFirePanelListResponse,
      label,
      toast,
    ],
  );

  const refreshList = useCallback(async () => {
    if (!connected) {
      toast({
        title: "Not connected",
        description: "Connect to the fire panel before requesting a list command.",
        variant: "destructive",
      });
      return;
    }

    try {
      await fetchFirePanelListResponse(label);
    } catch (error) {
      toast({
        title: "List command failed",
        description: error?.message || "Could not fetch panel list response.",
        variant: "destructive",
      });
    }
  }, [connected, fetchFirePanelListResponse, label, toast]);

  const fetchListRef = useRef(fetchFirePanelListResponse);
  fetchListRef.current = fetchFirePanelListResponse;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const initialListLoadedRef = useRef(null);

  useEffect(() => {
    if (!isReady || !connected) return;
    if (initialListLoadedRef.current === label) return;

    initialListLoadedRef.current = label;
    let cancelled = false;

    const loadList = async () => {
      try {
        await fetchListRef.current(label);
      } catch (error) {
        if (!cancelled) {
          toastRef.current({
            title: "List command failed",
            description: error?.message || "Could not fetch panel list response.",
            variant: "destructive",
          });
        }
      }
    };

    void loadList();

    return () => {
      cancelled = true;
    };
  }, [isReady, connected, label]);

  if (!isReady) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <DashboardTopBar headerClassName="flex h-16 shrink-0 items-center gap-2 border-b px-4" />

        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
          <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <Icon className={cn("h-6 w-6", TONE_CLASSES[tone])} />
              <div>
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {alertModalEnabled !== null ? (
                <div className="flex items-center gap-2 rounded-md border px-3 py-2">
                  <Switch
                    id={`${label}-page-alert-enabled`}
                    checked={alertModalEnabled}
                    onCheckedChange={handleAlertToggle}
                  />
                  <Label
                    htmlFor={`${label}-page-alert-enabled`}
                    className="cursor-pointer text-xs text-muted-foreground"
                  >
                    Popup alerts
                  </Label>
                </div>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!connected || isStreaming}
                onClick={() => void refreshList()}
              >
                {isStreaming ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                {isStreaming ? "Receiving list..." : "Refresh list"}
              </Button>
            </div>
          </div>

          {!connected ? (
            <p className="shrink-0 text-sm text-muted-foreground">
              Connect to the fire panel to load the latest list.
            </p>
          ) : (
            <div className="min-h-0 flex-1">
              {isStreaming && parsedRows.length > 0 ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  Streaming panel response — {parsedRows.length}
                  {expectedCount != null ? `/${expectedCount}` : ""} row
                  {parsedRows.length === 1 ? "" : "s"} so far
                </p>
              ) : null}
              <PanelAlarmList
                rows={parsedRows}
                emptyLabel={emptyLabel}
                pending={
                  isStreaming ||
                  (connected && expectedCount != null && expectedCount > 0 && parsedRows.length === 0)
                }
                tone={tone}
                highlightedAddresses={effectiveHighlightedAddresses}
                onRowAck={(row) => void handleRowAck(row)}
                acknowledgingAddress={acknowledgingAddress}
                listComplete={listComplete}
                expectedCount={expectedCount}
                listMessageCount={listMessageCount}
              />
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
