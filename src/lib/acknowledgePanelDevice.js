/**
 * Device-level panel acknowledge helpers.
 *
 * Category ack (modal):     ack f
 * Device ack (list row):    ack f 2:M1-2-0
 */

import { apiFetch, parseApiJsonResponse } from "@/lib/apiClient";
import { buildPanelAckCommand } from "@/lib/firePanelMonitor";
import { withMonitorPausedForPriority } from "@/lib/firePanelMonitorSession";
import { useFirePanelStore } from "@/stores/firePanelStore";

/** Send a priority telnet command (jumps ahead of list/CVAL work). */
export async function sendPriorityPanelCommand(command, timeoutMs = 5000) {
  const res = await apiFetch("/api/telnet/fire-panel/command/priority", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command, timeoutMs }),
  });
  const data = await parseApiJsonResponse(res);
  if (!res.ok) {
    throw new Error(data?.error || "Priority command failed");
  }
  return data;
}

/**
 * Acknowledge one device on the panel: `ack f {address}` / `ack t …` / `ack s …`.
 * Use this from live list row clicks — not the category-wide modal ack.
 *
 * @param {"Fire"|"Trouble"|"Supervisory"} label
 * @param {string} deviceAddress  e.g. "2:M1-2-0"
 */
export async function acknowledgeDevice(label, deviceAddress) {
  const address = String(deviceAddress || "").trim();
  if (!address) {
    throw new Error("Device address is required to acknowledge a device");
  }

  const connected = useFirePanelStore.getState().connected;
  if (!connected) {
    throw new Error("Connect to the fire panel before acknowledging.");
  }

  const cmd = buildPanelAckCommand(label, address);

  // Pause CVAL/list monitoring and send via the priority worker queue.
  return withMonitorPausedForPriority(() =>
    sendPriorityPanelCommand(cmd, 5000),
  );
}

/**
 * Category-wide acknowledge (no address): `ack f` / `ack t` / `ack s`.
 * Used by the fire / trouble / supervisory alert modals.
 */
export async function acknowledgeCategory(label) {
  const connected = useFirePanelStore.getState().connected;
  if (!connected) {
    throw new Error("Connect to the fire panel before acknowledging.");
  }

  const cmd = buildPanelAckCommand(label);
  console.log("cmd", cmd);
  return withMonitorPausedForPriority(() =>
    sendPriorityPanelCommand(cmd, 5000),
  );
}
