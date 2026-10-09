/**
 * `login 333` with retry, shared by AutoPilot, Silence / Reset and
 * Disable / Enable.
 *
 * The panel can freeze for ~10s right after a fire; its ACCESS GRANTED then
 * arrives late — sometimes after the command already returned with someone
 * else's output. So a login counts as granted when either:
 *   - the reply contains ACCESS GRANTED / ALREADY / the worker's
 *     "login still active" (3-minute login session), or
 *   - an ACCESS GRANTED line shows up in the panel logs after the first try.
 * Otherwise it is sent again, until LOGIN_MAX_MS after the first try.
 */

import { sendPriorityPanelCommand } from "@/lib/acknowledgePanelDevice";

const ATTEMPT_TIMEOUT_MS = 2000;
/** After a reply without ACCESS GRANTED, wait this long for the log line. */
const LOG_WAIT_MS = 1000;
const RETRY_GAP_MS = 300;
/** Stop retrying this long after the first attempt. */
const LOGIN_MAX_MS = 12000;
const POLL_MS = 50;

const GRANTED_RE = /ACCESS\s+GRANTED|ALREADY|login still active/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** When ACCESS GRANTED last appeared in the panel logs (FireModalContext event). */
let lastGrantedLogAt = 0;
if (typeof window !== "undefined") {
  window.addEventListener("vision365:panelLoginGranted", (event) => {
    lastGrantedLogAt = Number(event?.detail?.receivedAt) || Date.now();
  });
}

/**
 * Log in to the panel, retrying until access is granted.
 * Options: maxMs, onAttempt(attempt), onRetry(attempt, reason), shouldStop().
 * Resolves { granted, attempts, reason, via } — via: "reply" | "log".
 */
export async function loginToPanel({
  maxMs = LOGIN_MAX_MS,
  onAttempt,
  onRetry,
  shouldStop,
} = {}) {
  const start = Date.now();
  let attempts = 0;
  let reason = "";

  while (attempts === 0 || Date.now() - start < maxMs) {
    if (shouldStop?.()) return { granted: false, attempts, reason: "stopped" };
    attempts += 1;
    onAttempt?.(attempts);

    let reply = "";
    try {
      const result = await sendPriorityPanelCommand("login 333", ATTEMPT_TIMEOUT_MS);
      reply = String(result?.response ?? "");
    } catch (error) {
      reason = "no answer";
      console.warn(`[panelLogin] attempt ${attempts} failed:`, error?.message);
    }
    if (GRANTED_RE.test(reply)) return { granted: true, attempts, via: "reply" };
    if (/ACCESS\s+DENIED/i.test(reply)) reason = "access denied";
    else if (!reason) reason = "no answer";

    // The ACCESS GRANTED line may arrive after the reply (late panel output).
    const waitEnd = Date.now() + LOG_WAIT_MS;
    while (Date.now() < waitEnd) {
      if (lastGrantedLogAt >= start) return { granted: true, attempts, via: "log" };
      await sleep(POLL_MS);
    }
    if (lastGrantedLogAt >= start) return { granted: true, attempts, via: "log" };

    onRetry?.(attempts, reason);
    await sleep(RETRY_GAP_MS);
  }

  return { granted: false, attempts, reason };
}
