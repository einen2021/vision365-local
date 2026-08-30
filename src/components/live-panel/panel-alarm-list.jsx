"use client";

import { memo, useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatPanelListTime } from "@/lib/firePanelMonitor";

const STATUS_BADGE_CLASSES = {
  TRBL: "border-yellow-500/50 bg-yellow-500/10 text-yellow-800 dark:text-yellow-300",
  ALRM: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  FIRE: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
  SUPV: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  SUPR: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300",
  SUP: "border-purple-500/50 bg-purple-500/10 text-purple-700 dark:text-purple-300",
};

const ROW_HIGHLIGHT_CLASSES = {
  fire: "panel-row-highlight-fire",
  trouble: "panel-row-highlight-trouble",
  supervisory: "panel-row-highlight-supervisory",
};

function statusBadgeClass(status) {
  const key = String(status || "").replace(/\*$/, "").toUpperCase();
  return STATUS_BADGE_CLASSES[key] || "border-muted bg-muted/40 text-muted-foreground";
}

// Time | Address | Location | Device type | Status
const LIST_GRID = "md:grid-cols-[160px_140px_minmax(0,1fr)_150px_90px]";

const PanelAlarmRow = memo(function PanelAlarmRow({
  row,
  tone,
  isHighlighted,
  isAcknowledging,
  onRowAck,
  responseTimeLabel,
}) {
  const highlightClass = ROW_HIGHLIGHT_CLASSES[tone] || ROW_HIGHLIGHT_CLASSES.trouble;
  const timeLabel =
    formatPanelListTime(row.time || row.timestamp || row.panelTimeText) ||
    responseTimeLabel ||
    "—";

  const handleClick = onRowAck ? () => onRowAck(row) : undefined;
  const handleKeyDown = onRowAck
    ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onRowAck(row);
        }
      }
    : undefined;

  const tooltipTitle = onRowAck
    ? tone === "fire" || tone === "trouble"
      ? "Click to acknowledge and open floor plan"
      : "Click to acknowledge"
    : undefined;

  return (
    <li
      className={cn(
        "px-4 py-3 transition-colors animate-in fade-in slide-in-from-bottom-1 duration-200",
        onRowAck && "cursor-pointer hover:bg-muted/40",
        !onRowAck && "hover:bg-muted/30",
        isHighlighted && highlightClass,
        isAcknowledging && "opacity-60",
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      role={onRowAck ? "button" : undefined}
      tabIndex={onRowAck ? 0 : undefined}
      title={tooltipTitle}
    >
      <div className={cn("grid gap-2 md:items-center md:gap-3", LIST_GRID)}>
        <div>
          <p className="text-xs text-muted-foreground whitespace-nowrap">{timeLabel}</p>
          <p className="mt-0.5 font-mono text-sm font-medium md:hidden">
            {row.fullAddress}
          </p>
        </div>

        <div className="hidden md:block">
          <p className="font-mono text-sm font-medium">{row.fullAddress}</p>
        </div>

        <div className="md:contents">
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
            <p className="mt-0.5 text-[11px] text-muted-foreground md:hidden">
              {row.deviceType || "—"}
            </p>
          </div>
        </div>
      </div>
    </li>
  );
});

export function PanelAlarmList({
  rows = [],
  emptyLabel = "No active entries.",
  pending = false,
  tone = "trouble",
  highlightedAddresses = new Set(),
  onRowAck,
  acknowledgingAddress = null,
  listComplete = true,
  expectedCount = null,
  listMessageCount = 0,
  responseTimeLabel = "",
}) {
  // Keep newly highlighted rows at the top of the list
  const displayRows = useMemo(() => {
    if (!highlightedAddresses.size || !rows.length) return rows;

    const highlighted = [];
    const rest = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (highlightedAddresses.has(row.fullAddress)) {
        highlighted.push(row);
      } else {
        rest.push(row);
      }
    }
    return [...highlighted, ...rest];
  }, [rows, highlightedAddresses]);

  if (!rows.length) {
    if (pending || (expectedCount != null && expectedCount > 0)) {
      const skeletonRowCount = Math.min(Math.max(expectedCount || 6, 3), 8);
      return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border">
          <div
            className={cn(
              "hidden shrink-0 md:grid gap-3 border-b bg-muted/50 px-4 py-2 text-xs font-medium text-muted-foreground",
              LIST_GRID,
            )}
          >
            <span>Time</span>
            <span>Address</span>
            <span>Location</span>
            <span>Device type</span>
            <span>Status</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ul className="divide-y">
              {Array.from({ length: skeletonRowCount }).map((_, index) => (
                <li key={index} className="px-4 py-3">
                  <div className={cn("grid gap-2 md:items-center md:gap-3", LIST_GRID)}>
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-full max-w-[220px]" />
                    <Skeleton className="hidden h-4 w-28 md:block" />
                    <Skeleton className="h-5 w-14 rounded-full" />
                  </div>
                </li>
              ))}
            </ul>
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
        <span>Time</span>
        <span>Address</span>
        <span>Location</span>
        <span>Device type</span>
        <span>Status</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <ul className="divide-y">
          {displayRows.map((row, index) => (
            <PanelAlarmRow
              key={`${row.fullAddress}-${index}`}
              row={row}
              tone={tone}
              isHighlighted={highlightedAddresses.has(row.fullAddress)}
              isAcknowledging={acknowledgingAddress === row.fullAddress}
              onRowAck={onRowAck}
              responseTimeLabel={responseTimeLabel}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
