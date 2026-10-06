/**
 * Device-level panel acknowledge helpers.
 *
 * Category ack (modal):     ack f
 * Device ack (list row):    ack f 2:M1-2-0
 */

import { apiFetch, parseApiJsonResponse } from "@/lib/apiClient";
import { buildPanelAckCommand } from "@/lib/firePanelMonitor";
import { withMonitorPaused } from "@/lib/firePanelMonitorSession";
import { useFirePanelStore } from "@/stores/firePanelStore";

import { isDebugMode } from "@/lib/debugMode";

/** Send a telnet command via standard queue. */
export async function sendPriorityPanelCommand(command, timeoutMs = 5000) {
  try {
    const res = await apiFetch("/api/telnet/fire-panel/command", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeoutMs }),
    });
    const data = await parseApiJsonResponse(res);
    if (!res.ok) {
      if (isDebugMode()) {
        return { response: "OK", ok: true };
      }
      throw new Error(data?.error || "Command failed");
    }
    return data;
  } catch (err) {
    if (isDebugMode()) {
      return { response: "OK", ok: true };
    }
    throw err;
  }
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

  return withMonitorPaused(() => sendPriorityPanelCommand(cmd, 5000));
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
  return withMonitorPaused(() => sendPriorityPanelCommand(cmd, 5000));
}
