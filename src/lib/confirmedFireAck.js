/**
 * Fire acknowledge.
 *
 * Sends a bare `ack` once. The panel worker confirms it by its echo ("- ack" =
 * executed) and resends it itself only when the panel ignored it — so it is
 * never sent again here: a second executed `ack` would acknowledge another
 * event. Right after a fire the panel can take 10–30s to print "FIRE ALARM
 * ACKED" (and `list f` still shows FIRE* meanwhile), so neither is used to
 * decide on a resend; the ACKED line is awaited briefly only for reporting.
 */

import { sendPriorityPanelCommand } from "@/lib/acknowledgePanelDevice";

/** Wait this long for "FIRE ALARM ACKED" after the ack executed. */
const ACK_LOG_WAIT_MS = 2000;
const POLL_MS = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Arrival time of the newest fire acknowledgement line in the panel logs. */
let lastFireAckLoggedAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("vision365:livePanelEntry", (event) => {
    const { type, label, receivedAt } = event?.detail || {};
    if (type === "ack" && label === "Fire") {
      lastFireAckLoggedAt = Number(receivedAt) || Date.now();
    }
  });
}

async function waitForAckLine(since, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (lastFireAckLoggedAt >= since) return true;
    await sleep(POLL_MS);
  }
  return lastFireAckLoggedAt >= since;
}

/**
 * Send `ack` once. Never throws. Resolves { acknowledged, logged, attempts, ms,
 * via, error } — `acknowledged` once the panel executed it ("- ack"), `logged`
 * once FIRE ALARM ACKED was seen within 2s.
 */
export async function acknowledgeFireConfirmed() {
  const start = Date.now();
  try {
    await sendPriorityPanelCommand("ack");
  } catch (error) {
    console.warn("[confirmedFireAck] ack failed:", error?.message);
    return {
      acknowledged: false,
      logged: false,
      attempts: 1,
      ms: Date.now() - start,
      via: null,
      error: error?.message || "ack failed",
    };
  }
  const logged = await waitForAckLine(start, ACK_LOG_WAIT_MS);
  return {
    acknowledged: true,
    logged,
    attempts: 1,
    ms: Date.now() - start,
    via: logged ? "log" : "echo",
  };
}
