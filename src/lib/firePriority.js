/**
 * Fire priority. While the panel reports FIRE > 0, trouble and supervisory work
 * is held: no `list t` / `list s`, no T / S flag (marker colour) changes, no
 * trouble / supervisory list writes, alerts or AutoPilot runs. Only `show counts`
 * keeps running. Whatever was skipped is recorded here and caught up once
 * `show counts` reports FIRE = 0 (see setFireClearedHandler).
 *
 * The desktop panel worker enforces the same rule on its side: it refuses
 * `list t` / `list s` while a fire is active.
 */

/** Panel fire count: last `show counts`, raised at once by a live FIRE ALARM line. */
let fireCount = 0;
/** True once a real `show counts` reply was seen (the stored seed no longer applies). */
let haveShowCounts = false;
/** Last full counts from `show counts` — handed to the fire-cleared handler. */
let lastCounts = null;
/** Categories whose work was skipped during the fire (re-listed after it). */
const deferredSync = { Trouble: false, Supervisory: false };
/** Categories with a new alarm during the fire (alerted after it). */
const deferredAlert = { Trouble: false, Supervisory: false };
let clearedHandler = null;
const listeners = new Set();

const HELD_LABELS = new Set(["Trouble", "Supervisory"]);

function normalizeLabel(label) {
  if (/^trouble$/i.test(String(label || ""))) return "Trouble";
  if (/^supervisory$/i.test(String(label || ""))) return "Supervisory";
  return null;
}

function notify() {
  const active = fireCount > 0;
  for (const listener of [...listeners]) {
    try {
      listener(active);
    } catch (error) {
      console.error("[firePriority] listener failed:", error);
    }
  }
}

function setFireCount(next, reason) {
  const wasActive = fireCount > 0;
  fireCount = Math.max(0, Number(next) || 0);
  const isActive = fireCount > 0;
  if (wasActive === isActive) return;

  console.log(
    `[firePriority] ${isActive ? "ON" : "OFF"} (${reason}) — trouble / supervisory work ${isActive ? "held" : "resumed"}`,
  );
  notify();
  if (!isActive) runClearedHandler();
}

function runClearedHandler() {
  const sync = { ...deferredSync };
  const alert = { ...deferredAlert };
  deferredSync.Trouble = deferredSync.Supervisory = false;
  deferredAlert.Trouble = deferredAlert.Supervisory = false;
  if (!sync.Trouble && !sync.Supervisory && !alert.Trouble && !alert.Supervisory) return;
  if (!clearedHandler) return;
  // After the caller's own handling of this `show counts` reply.
  setTimeout(() => {
    try {
      void clearedHandler({ counts: lastCounts, sync, alert });
    } catch (error) {
      console.error("[firePriority] fire-cleared handler failed:", error);
    }
  }, 0);
}

/** True while the panel has an active fire (FIRE > 0). */
export function isFirePriorityActive() {
  return fireCount > 0;
}

/** True when work for this category must wait (Trouble / Supervisory during a fire). */
export function isHeldByFirePriority(label) {
  return fireCount > 0 && HELD_LABELS.has(normalizeLabel(label));
}

/** A live FIRE ALARM line arrived — hold trouble / supervisory before `show counts` confirms. */
export function noteLiveFireAlarm() {
  if (fireCount === 0) setFireCount(1, "live FIRE ALARM");
}

/** Every parsed `show counts` reply goes through here (the authoritative fire count). */
export function noteShowCounts(counts) {
  if (!counts || !Number.isFinite(Number(counts.totalFire))) return;
  haveShowCounts = true;
  lastCounts = {
    totalFire: Number(counts.totalFire) || 0,
    totalTrouble: Number(counts.totalTrouble) || 0,
    totalSupervisory: Number(counts.totalSupervisory) || 0,
  };
  setFireCount(lastCounts.totalFire, `show counts FIRE = ${lastCounts.totalFire}`);
}

/** Stored panel-state seed after a reload — ignored once a `show counts` reply was seen. */
export function seedFireCountFromStoredState(totalFire) {
  if (haveShowCounts) return;
  const n = Number(totalFire) || 0;
  if (n > 0 && fireCount === 0) setFireCount(n, "stored panel state");
}

/**
 * Record skipped work for "Trouble", "Supervisory" or "both". `alert`: a new
 * alarm arrived, so its alert (beep / popup / Ack blink) is raised after the fire.
 */
export function deferForFirePriority(label, { alert = false } = {}) {
  const labels = label === "both" ? ["Trouble", "Supervisory"] : [normalizeLabel(label)];
  for (const each of labels) {
    if (!each) continue;
    deferredSync[each] = true;
    if (alert) deferredAlert[each] = true;
  }
}

/**
 * Forget deferred re-lists — the caller is about to re-list every category
 * itself (a held one defers itself again). Deferred alerts are kept.
 */
export function clearFirePriorityDeferrals() {
  deferredSync.Trouble = deferredSync.Supervisory = false;
}

/**
 * Called once FIRE drops to 0 with whatever was skipped:
 * `{ counts, sync: { Trouble, Supervisory }, alert: { Trouble, Supervisory } }`.
 */
export function setFireClearedHandler(handler) {
  clearedHandler = handler;
  return () => {
    if (clearedHandler === handler) clearedHandler = null;
  };
}

/** Subscribe to fire priority on / off. Returns unsubscribe. */
export function onFirePriorityChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Error message for a list command held by fire priority. */
export function firePriorityHoldMessage(label) {
  const name = normalizeLabel(label) || "This";
  return `Fire alarm active — ${name.toLowerCase()} list waits until the fire count is 0.`;
}
