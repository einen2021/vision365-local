/**
 * Trouble / Supervisory acknowledge.
 *
 * Sends a bare `ack` once. The panel worker confirms it by its echo ("- ack" =
 * executed) and resends it itself only when the panel ignored it, so it is never
 * sent again here — a second executed `ack` would acknowledge another event.
 * The panel's ACKED line is then awaited (up to 2s) only to report whether the
 * acknowledgement was already logged.
 */

import { sendPriorityPanelCommand } from "@/lib/acknowledgePanelDevice";
import { buildPanelAckCommand } from "@/lib/firePanelMonitor";

/** Wait this long for the ACKED line after the ack executed. */
const ACK_LOG_WAIT_MS = 2000;
const POLL_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Arrival time of the newest acknowledgement line per category. */
const lastAckLoggedAt = { Trouble: 0, Supervisory: 0 };
if (typeof window !== "undefined") {
  window.addEventListener("vision365:livePanelEntry", (event) => {
    const { type, label, receivedAt } = event?.detail || {};
    if (type === "ack" && label in lastAckLoggedAt) {
      lastAckLoggedAt[label] = Number(receivedAt) || Date.now();
    }
  });
}

async function waitForAckLine(label, since, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (lastAckLoggedAt[label] >= since) return true;
    await sleep(POLL_MS);
  }
  return lastAckLoggedAt[label] >= since;
}

/**
 * Send `ack` for a Trouble / Supervisory alert. Throws when the panel worker
 * could not get it executed. Resolves { acknowledged, sent, attempts, ms } —
 * `acknowledged` is true once the panel's ACKED line was logged.
 */
export async function acknowledgeAlertConfirmed(label) {
  if (!(label in lastAckLoggedAt)) {
    throw new Error(`Unknown alert type: ${label}`);
  }
  const start = Date.now();
  await sendPriorityPanelCommand(buildPanelAckCommand(label));
  const acknowledged = await waitForAckLine(label, start, ACK_LOG_WAIT_MS);
  return { acknowledged, sent: true, attempts: 1, ms: Date.now() - start };
}
