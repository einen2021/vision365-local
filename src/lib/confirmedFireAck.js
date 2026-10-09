/**
 * Fire acknowledge that is confirmed, not just sent.
 *
 * The panel can take 10–30s to report "FIRE ALARM ACKED" — right after a fire
 * it often goes quiet for ~10s and answers nothing. So: send `ack`, wait up to
 * 2s for that line, otherwise read `list f`:
 *   - fire row(s) with no `*`  → accepted (the line is just late);
 *   - a row still `FIRE*`      → send `ack` again;
 *   - no fire row came back    → the panel is busy; keep waiting, type nothing.
 * Repeats until ~6s.
 *
 * `ack` is only re-sent while a fire is still `FIRE*`, so a repeat can never
 * acknowledge something else (e.g. one of the troubles, all `TRBL*`).
 */

import { sendPriorityPanelCommand } from "@/lib/acknowledgePanelDevice";

/** Wait this long for "FIRE ALARM ACKED" before checking `list f`. */
const ACK_LOG_WAIT_MS = 2000;
/** Give up re-sending after this long. */
const CONFIRM_BUDGET_MS = 6000;
const ACK_TIMEOUT_MS = 2000;
const LIST_F_TIMEOUT_MS = 2500;
const POLL_MS = 50;

/** A `list f` device row ending in FIRE / ALARM, with or without the `*`. */
const FIRE_ROW_RE =
  /(?:^|\n)\s*(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b[^\n]*\b(?:FIRE|ALARM)(\*?)[ \t]*(?=\n|$)/gi;

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
 * Read `list f`: "acked" when it lists fire row(s) and none is starred,
 * "unacked" when a row is still `FIRE*`, "unknown" when no fire row came back
 * (an empty or timed-out reply proves nothing).
 */
async function fireListAckState() {
  try {
    const result = await sendPriorityPanelCommand("list f", LIST_F_TIMEOUT_MS);
    const text = String(result?.response ?? "").replace(/\r/g, "");
    const rows = [...text.matchAll(FIRE_ROW_RE)];
    if (rows.length === 0) return "unknown";
    return rows.some((row) => row[1] === "*") ? "unacked" : "acked";
  } catch {
    return "unknown";
  }
}

/**
 * Send `ack` and keep it going until the panel has accepted it, within ~6s.
 * Resolves { acknowledged, attempts, ms, via } — via: "log" | "list" | null.
 */
export async function acknowledgeFireConfirmed() {
  const start = Date.now();
  let attempts = 0;
  let resend = true;

  while (Date.now() - start < CONFIRM_BUDGET_MS) {
    if (resend) {
      attempts += 1;
      try {
        await sendPriorityPanelCommand("ack", ACK_TIMEOUT_MS);
      } catch (error) {
        console.warn(`[confirmedFireAck] ack attempt ${attempts} failed:`, error?.message);
      }
    }

    // Any ACKED line since the first ack counts — the panel may report it late.
    const remaining = CONFIRM_BUDGET_MS - (Date.now() - start);
    if (await waitForAckLine(start, Math.min(ACK_LOG_WAIT_MS, Math.max(0, remaining)))) {
      return { acknowledged: true, attempts, ms: Date.now() - start, via: "log" };
    }
    if (Date.now() - start >= CONFIRM_BUDGET_MS) break;

    const state = await fireListAckState();
    if (state === "acked") {
      return { acknowledged: true, attempts, ms: Date.now() - start, via: "list" };
    }
    // Only a row still marked FIRE* justifies another ack; an empty reply
    // means the panel is busy — keep waiting without typing more into it.
    resend = state === "unacked";
    console.log(
      `[confirmedFireAck] after attempt ${attempts} (${Date.now() - start}ms): list f = ${state}${resend ? " — sending ack again" : " — waiting"}`,
    );
  }

  if (lastFireAckLoggedAt >= start) {
    return { acknowledged: true, attempts, ms: Date.now() - start, via: "log" };
  }
  return { acknowledged: false, attempts, ms: Date.now() - start, via: null };
}
