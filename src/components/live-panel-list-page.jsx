"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Clock, Eye, Flame, Loader2, RefreshCcw } from "lucide-react";
import { AppSidebar } from "@/components/app-sidebar";
import { DashboardTopBar } from "@/components/dashboard-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { usePageAuth } from "@/hooks/usePageAuth";
import { useToast } from "@/hooks/use-toast";
import { formatPanelListTime, parsePanelListResponse } from "@/lib/firePanelMonitor";
import {
  fetchCategoryHistoryMessages,
  isPanelRowInHistory,
  pickNewestUnknownRow,
} from "@/lib/livePanelListHighlight";
import {
  silenceSupervisoryAlertBeep,
  silenceTroubleAlertBeep,
} from "@/lib/troubleAlertBeep";
import { cn } from "@/lib/utils";
import { useApp } from "@/contexts/AppContext";
import { useLivePanelAlert } from "@/contexts/LivePanelAlertContext";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

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

// Address | Location | Device type | Status | Date/Time (only for new rows)
const LIST_GRID = "md:grid-cols-[140px_minmax(0,1fr)_150px_90px_170px]";

function PanelAlarmList({
  rows,
  emptyLabel,
  pending = false,
  tone = "trouble",
  highlightedAddresses = new Set(),
  onRowAck,
  acknowledgingAddress = null,
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
    if (pending) {
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
            <span>Date / Time</span>
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
        <span>Date / Time</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y">
        {displayRows.map((row, index) => {
          const isHighlighted = highlightedAddresses.has(row.fullAddress);
          const isAcknowledging = acknowledgingAddress === row.fullAddress;
          // Only newest (not-in-history) rows carry a timestamp.
          const timeLabel = row.showTime ? row.formattedTime || "—" : "";

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

              <div className="flex items-start gap-1.5 text-xs text-muted-foreground md:text-sm">
                {timeLabel ? (
                  <>
                    <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                    <span className="leading-snug tabular-nums">{timeLabel}</span>
                  </>
                ) : (
                  <span className="text-muted-foreground/40">—</span>
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
      </div>
    </div>
  );
}

/** Highlight only the newest row that is not already in alarm history. */
function useNewestHistoryHighlight(parsedRows, label, buildingNames, listVersion) {
  const baselineRef = useRef(new Set());
  const initializedRef = useRef(false);
  const [historyMessages, setHistoryMessages] = useState([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [highlightedAddresses, setHighlightedAddresses] = useState(() => new Set());

  const buildingKey = useMemo(
    () => buildingNames.join("|"),
    [buildingNames],
  );

  useEffect(() => {
    let cancelled = false;
    setHistoryReady(false);

    const loadHistory = async () => {
      const messages = await fetchCategoryHistoryMessages(label, buildingNames);
      if (!cancelled) {
        setHistoryMessages(messages);
        setHistoryReady(true);
      }
    };

    void loadHistory();
    const interval = window.setInterval(() => {
      void loadHistory();
    }, 10000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [label, buildingKey, buildingNames]);

  useEffect(() => {
    if (!parsedRows.length) {
      setHighlightedAddresses((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    if (!initializedRef.current) {
      for (const row of parsedRows) {
        baselineRef.current.add(row.fullAddress);
      }
      initializedRef.current = true;
      setHighlightedAddresses((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

    const newest = pickNewestUnknownRow(
      parsedRows,
      historyMessages,
      baselineRef.current,
    );
    const next = newest ? new Set([newest.fullAddress]) : new Set();

    setHighlightedAddresses((prev) => (setsEqual(prev, next) ? prev : next));

    for (const row of parsedRows) {
      baselineRef.current.add(row.fullAddress);
    }
  }, [historyMessages, listVersion, parsedRows]);

  useEffect(() => {
    if (!historyMessages.length || !parsedRows.length) return;

    for (const row of parsedRows) {
      if (isPanelRowInHistory(row, historyMessages)) {
        baselineRef.current.add(row.fullAddress);
      }
    }

    setHighlightedAddresses((prev) => {
      if (!prev.size) return prev;
      const highlighted = [...prev][0];
      const row = parsedRows.find((entry) => entry.fullAddress === highlighted);
      if (row && isPanelRowInHistory(row, historyMessages)) {
        return new Set();
      }
      return prev;
    });
  }, [historyMessages, parsedRows]);

  return { highlightedAddresses, historyMessages, historyReady };
}

/** Shared layout for live fire / trouble / supervisory list pages. */
export function LivePanelListPage({ label, title, description, tone }) {
  const { isReady } = usePageAuth({ redirectIfLoggedOut: true });
  const { toast } = useToast();
  const { allBuildings } = useApp();
  const connected = useFirePanelStore((s) => s.connected);
  const {
    firePanelListResponses,
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
  // Remember when each "new" (not-in-history) address first appeared on this page.
  const firstSeenRef = useRef(new Map());

  const Icon = PAGE_ICONS[label] || Flame;
  const cached = firePanelListResponses?.[label] ?? null;
  // Parse the raw panel list into table rows (address, location, type, status).
  const parsedRows = useMemo(
    () => (cached?.response ? parsePanelListResponse(cached.response) : []),
    [cached?.response],
  );
  const listVersion = cached?.fetchedAt ?? "empty";
  const buildingNames = useMemo(
    () => allBuildings.map((building) => building.name).filter(Boolean),
    [allBuildings],
  );
  // Highlight only the newest row that is not already in alarm history.
  const { highlightedAddresses, historyMessages, historyReady } = useNewestHistoryHighlight(
    parsedRows,
    label,
    buildingNames,
    listVersion,
  );

  // Stamp date/time only for rows that are not yet in the matching history array
  // (liveFire / liveTrouble / liveSupervisory). Older known rows stay blank.
  const rowsWithTime = useMemo(() => {
    // Wait for history so we do not briefly stamp every row as "new".
    if (!historyReady) {
      return parsedRows.map((row) => ({
        ...row,
        showTime: false,
        formattedTime: "",
      }));
    }

    const fetchedMs = cached?.fetchedAt ? Date.parse(cached.fetchedAt) : Date.now();
    const fallbackMs = Number.isFinite(fetchedMs) ? fetchedMs : Date.now();
    const seen = firstSeenRef.current;
    const active = new Set(parsedRows.map((row) => row.fullAddress));

    for (const key of [...seen.keys()]) {
      if (!active.has(key)) seen.delete(key);
    }

    return parsedRows.map((row) => {
      const isLatest = !isPanelRowInHistory(row, historyMessages);

      if (!isLatest) {
        seen.delete(row.fullAddress);
        return {
          ...row,
          showTime: false,
          formattedTime: "",
        };
      }

      if (!seen.has(row.fullAddress)) {
        seen.set(row.fullAddress, fallbackMs);
      }

      const eventTime = row.panelTimeText || seen.get(row.fullAddress) || fallbackMs;

      return {
        ...row,
        showTime: true,
        formattedTime: formatPanelListTime(eventTime) || "—",
      };
    });
  }, [parsedRows, historyMessages, historyReady, cached?.fetchedAt]);

  const isStreaming = Boolean(cached?.streaming);
  // Hide highlight after the user acknowledges that row.
  const effectiveHighlightedAddresses = useMemo(() => {
    if (!ackedAddresses.size) return highlightedAddresses;

    const next = new Set(highlightedAddresses);
    for (const address of ackedAddresses) {
      next.delete(address);
    }
    return next;
  }, [ackedAddresses, highlightedAddresses]);
  const emptyLabel = EMPTY_LABELS[label] || "No active entries.";

  // Stable key of current addresses so we can drop acks for rows that left the list.
  const rowKey = useMemo(
    () => rowsWithTime.map((row) => row.fullAddress).join("|"),
    [rowsWithTime],
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

        await fetchFirePanelListResponse(label);
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
              <button
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
              </button>
            </div>
          </div>

          {!connected ? (
            <p className="shrink-0 text-sm text-muted-foreground">
              Connect to the fire panel to load the latest list.
            </p>
          ) : (
            <div className="min-h-0 flex-1">
              {isStreaming && rowsWithTime.length > 0 ? (
                <p className="mb-2 text-xs text-muted-foreground">
                  Streaming panel response — {rowsWithTime.length} row
                  {rowsWithTime.length === 1 ? "" : "s"} received so far
                </p>
              ) : null}
              <PanelAlarmList
                rows={rowsWithTime}
                emptyLabel={emptyLabel}
                pending={isStreaming && rowsWithTime.length === 0}
                tone={tone}
                highlightedAddresses={effectiveHighlightedAddresses}
                onRowAck={(row) => void handleRowAck(row)}
                acknowledgingAddress={acknowledgingAddress}
              />
            </div>
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
