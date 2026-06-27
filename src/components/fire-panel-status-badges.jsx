"use client";

import { Badge } from "@/components/ui/badge";
import { useFirePanelMonitor } from "@/contexts/AppContext";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { FirePanelAckButtons } from "@/components/fire-panel-ack-buttons";

/** Fire panel connection, monitoring, and live data status for dashboard headers. */
export function FirePanelStatusBadges() {
  const { firePanelMonitoring } = useFirePanelMonitor();
  const connected = useFirePanelStore((s) => s.connected);
  const connectedHost = useFirePanelStore((s) => s.connectedHost);
  const connectedPort = useFirePanelStore((s) => s.connectedPort);

  return (
    <>
      <FirePanelAckButtons />
      {firePanelMonitoring ? (
        <Badge variant="outline" className="border-blue-500/50 text-blue-600">
          Monitoring
        </Badge>
      ) : null}
      {connected ? (
        <Badge variant="outline" className="border-green-500/50 text-green-600">
          Connected {connectedHost}:{connectedPort}
        </Badge>
      ) : (
        <Badge variant="secondary">Disconnected</Badge>
      )}
    </>
  );
}
