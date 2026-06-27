"use client";

import { Wifi, WifiOff } from "lucide-react";
import { useFirePanelMonitor } from "@/contexts/AppContext";

/**
 * Live data status — Online when fire-panel monitoring is active, otherwise Offline.
 * Optional building-level Live/Polling when monitoring is off (floor map pages).
 */
export function MonitoringLiveStatus({
  lastUpdate = null,
  connectionType = "none",
  isConnected = false,
  className = "",
}) {
  const { firePanelMonitoring, firePanelState } = useFirePanelMonitor();
  const lastPanelSync = firePanelState?.lastPanelSync;

  const updatedAt =
    firePanelMonitoring && lastPanelSync
      ? new Date(lastPanelSync)
      : lastUpdate instanceof Date
        ? lastUpdate
        : lastUpdate
          ? new Date(lastUpdate)
          : null;

  if (firePanelMonitoring) {
    return (
      <div className={`flex items-center gap-4 ${className}`.trim()}>
        <div className="flex items-center gap-2 text-green-600">
          <Wifi className="h-4 w-4" />
          <span className="text-sm font-medium">Online</span>
        </div>
        {updatedAt ? (
          <span className="text-xs text-muted-foreground">
            Updated: {updatedAt.toLocaleTimeString()}
          </span>
        ) : null}
      </div>
    );
  }

  if (connectionType === "sse" && isConnected) {
    return (
      <div className={`flex items-center gap-4 ${className}`.trim()}>
        <div className="flex items-center gap-2 text-green-600">
          <Wifi className="h-4 w-4" />
          <span className="text-sm font-medium">Live</span>
        </div>
        {updatedAt ? (
          <span className="text-xs text-muted-foreground">
            Updated: {updatedAt.toLocaleTimeString()}
          </span>
        ) : null}
      </div>
    );
  }

  if (connectionType === "polling" && isConnected) {
    return (
      <div className={`flex items-center gap-4 ${className}`.trim()}>
        <div className="flex items-center gap-2 text-orange-600">
          <Wifi className="h-4 w-4" />
          <span className="text-sm font-medium">Polling</span>
        </div>
        {updatedAt ? (
          <span className="text-xs text-muted-foreground">
            Updated: {updatedAt.toLocaleTimeString()}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`flex items-center gap-4 ${className}`.trim()}>
      <div className="flex items-center gap-2 text-gray-400">
        <WifiOff className="h-4 w-4" />
        <span className="text-sm font-medium">Offline</span>
      </div>
      {updatedAt ? (
        <span className="text-xs text-muted-foreground">
          Updated: {updatedAt.toLocaleTimeString()}
        </span>
      ) : null}
    </div>
  );
}
