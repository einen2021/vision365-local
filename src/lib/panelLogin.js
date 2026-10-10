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
 *
 * With `reuseWithinMs`, a login granted less than that long ago is reused
 * and `login 333` isn't sent again (the panel keeps a login for 3 minutes).
 */

import { sendPriorityPanelCommand } from "@/lib/acknowledgePanelDevice";

const ATTEMPT_TIMEOUT_MS = 2000;
/** After a reply without ACCESS GRANTED, wait this long for the log line. */
const LOG_WAIT_MS = 1000;
const RETRY_GAP_MS = 300;
/** Stop retrying this long after the first attempt. */
const LOGIN_MAX_MS = 12000;
/** How long the panel keeps a login active. */
export const PANEL_LOGIN_SESSION_MS = 3 * 60 * 1000;

const GRANTED_RE = /ACCESS\s+GRANTED|ALREADY|login still active/i;

/** When ACCESS GRANTED last appeared in the panel logs (FireModalContext event). */
let lastGrantedLogAt = 0;
/** When a login was last granted (reply or log line). */
let lastGrantedAt = 0;
/** Waiters woken the moment an ACCESS GRANTED log line arrives. */
const grantWaiters = new Set();
if (typeof window !== "undefined") {
  window.addEventListener("vision365:panelLoginGranted", (event) => {
    lastGrantedLogAt = Number(event?.detail?.receivedAt) || Date.now();
    lastGrantedAt = Math.max(lastGrantedAt, lastGrantedLogAt);
    for (const wake of grantWaiters) wake();
  });
}

/**
 * Resolves true as soon as an ACCESS GRANTED log line at/after `since` is
 * seen, or false after `ms` (or when `shouldStop()` turns true).
 */
function waitForGrantLog(since, ms, shouldStop) {
  if (lastGrantedLogAt >= since) return Promise.resolve(true);
  return new Promise((resolve) => {
    let stopTimer = null;
    const finish = (granted) => {
      grantWaiters.delete(wake);
      clearTimeout(timer);
      clearInterval(stopTimer);
      resolve(granted);
    };
    const wake = () => {
      if (lastGrantedLogAt >= since) finish(true);
    };
    const timer = setTimeout(() => finish(lastGrantedLogAt >= since), Math.max(0, ms));
    if (shouldStop) stopTimer = setInterval(() => shouldStop() && finish(false), 100);
    grantWaiters.add(wake);
  });
}

/**
 * Log in to the panel, retrying until access is granted. Stops the moment an
 * ACCESS GRANTED line shows up in the panel logs — also while a `login 333`
 * is still waiting for its reply, or between retries.
 * Options: maxMs, reuseWithinMs, onAttempt(attempt), onRetry(attempt, reason),
 * shouldStop().
 * Resolves { granted, attempts, reason, via } — via: "reply" | "log" | "session".
 */
export async function loginToPanel({
  maxMs = LOGIN_MAX_MS,
  reuseWithinMs = 0,
  onAttempt,
  onRetry,
  shouldStop,
} = {}) {
  const start = Date.now();
  if (reuseWithinMs > 0 && lastGrantedAt > 0 && start - lastGrantedAt < reuseWithinMs) {
    return { granted: true, attempts: 0, via: "session" };
  }
  let attempts = 0;
  let reason = "";
  const grantedByLog = () => ({ granted: true, attempts, via: "log" });

  while (attempts === 0 || Date.now() - start < maxMs) {
    if (shouldStop?.()) return { granted: false, attempts, reason: "stopped" };
    if (lastGrantedLogAt >= start) return grantedByLog();
    attempts += 1;
    onAttempt?.(attempts);

    // Whichever comes first: the command's reply or the ACCESS GRANTED log line.
    const send = sendPriorityPanelCommand("login 333", ATTEMPT_TIMEOUT_MS).then(
      (result) => ({ reply: String(result?.response ?? "") }),
      (error) => ({ reply: "", error }),
    );
    const outcome = await Promise.race([
      send,
      waitForGrantLog(start, ATTEMPT_TIMEOUT_MS + LOG_WAIT_MS, shouldStop).then((granted) =>
        granted ? { log: true } : send,
      ),
    ]);
    if (outcome.log) return grantedByLog();

    const { reply, error } = outcome;
    if (error) {
      reason = "no answer";
      console.warn(`[panelLogin] attempt ${attempts} failed:`, error?.message);
    }
    if (GRANTED_RE.test(reply)) {
      // "login still active" / ALREADY don't start a new session — keep the old time.
      if (/ACCESS\s+GRANTED/i.test(reply)) lastGrantedAt = Date.now();
      else if (!lastGrantedAt) lastGrantedAt = Date.now();
      return { granted: true, attempts, via: "reply" };
    }
    if (/ACCESS\s+DENIED/i.test(reply)) reason = "access denied";
    else if (!reason) reason = "no answer";

    // The ACCESS GRANTED line may arrive after the reply (late panel output).
    if (await waitForGrantLog(start, LOG_WAIT_MS, shouldStop)) return grantedByLog();

    onRetry?.(attempts, reason);
    if (await waitForGrantLog(start, RETRY_GAP_MS, shouldStop)) return grantedByLog();
  }

  return { granted: false, attempts, reason };
}
