/** Persists monitor intent across reloads; loop flag survives React remounts. */

const STORAGE_KEY = "vision365.firePanelMonitoring";

/**
 * Keep session flags on globalThis so webpack/Tauri chunk splits cannot
 * duplicate this module and break pause coordination (modal vs monitor loop).
 */
function getSessionState() {
  const g = globalThis;
  if (!g.__vision365FirePanelMonitor) {
    g.__vision365FirePanelMonitor = {
      loopActive: false,
      loopPaused: false,
      cycleRunning: false,
      pauseDepth: 0,
      exclusiveCommandChain: Promise.resolve(),
    };
  }
  return g.__vision365FirePanelMonitor;
}

export function isFirePanelMonitoringPersisted() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === "1";
}

export function setFirePanelMonitoringPersisted(active) {
  if (typeof window === "undefined") return;
  if (active) sessionStorage.setItem(STORAGE_KEY, "1");
  else sessionStorage.removeItem(STORAGE_KEY);
}

export function isMonitorLoopActive() {
  return getSessionState().loopActive;
}

export function isMonitorLoopPaused() {
  return getSessionState().loopPaused;
}

export function isMonitorCycleRunning() {
  return getSessionState().cycleRunning;
}

export function setMonitorCycleRunning(active) {
  getSessionState().cycleRunning = Boolean(active);
}

export function pauseMonitorLoop() {
  const state = getSessionState();
  state.pauseDepth += 1;
  state.loopPaused = true;
}

export function resumeMonitorLoop() {
  const state = getSessionState();
  state.pauseDepth = Math.max(0, state.pauseDepth - 1);
  state.loopPaused = state.pauseDepth > 0;
}

/** Clear every pause so CVAL polling can continue (emergency unlock). */
export function forceResumeMonitorLoop() {
  const state = getSessionState();
  state.pauseDepth = 0;
  state.loopPaused = false;
}

/**
 * Wait until the current monitor cycle yields after pauseMonitorLoop().
 * Prefer waiting out list/CVAL commands instead of force-clearing early.
 */
export async function waitForMonitorYield(maxMs = 20000) {
  const start = Date.now();
  while (isMonitorCycleRunning() && Date.now() - start < maxMs) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  // Last resort — avoids deadlock if a cycle never cleared its running flag.
  if (isMonitorCycleRunning()) {
    console.warn(
      "[fire-panel] monitor cycle still running after wait — forcing yield",
    );
    setMonitorCycleRunning(false);
  }
}

/**
 * Pause CVAL polling, run a panel command, then resume this pause layer only.
 * Uses resume (not force-resume) so a held modal pause is not wiped.
 * Commands are serialized so two shows cannot interleave.
 */
export async function withMonitorPaused(fn) {
  const state = getSessionState();

  const run = state.exclusiveCommandChain.then(async () => {
    pauseMonitorLoop();
    try {
      // Wait long enough for an in-flight list t/f/s to finish before starting ours.
      await waitForMonitorYield(180000);
      // Brief settle so leftover CVAL bytes are less likely to pollute the next command.
      await new Promise((resolve) => setTimeout(resolve, 250));
      return await fn();
    } finally {
      // Decrement only this pause — do not clear a parent hold (e.g. open modal).
      resumeMonitorLoop();
    }
  });

  // Keep the chain alive even when a command fails.
  state.exclusiveCommandChain = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
}

/**
 * Pause the monitor loop and run immediately — do NOT wait on the command chain.
 * Used for ack/silence/show where waiting behind a 200-row list dump is unacceptable.
 * The worker-side priority queue ensures the command jumps ahead of any in-flight list.
 */
export async function withMonitorPausedForPriority(fn) {
  pauseMonitorLoop();
  try {
    return await fn();
  } finally {
    resumeMonitorLoop();
  }
}

export function setMonitorLoopActive(active) {
  const state = getSessionState();
  state.loopActive = Boolean(active);
  if (!active) {
    state.loopPaused = false;
    state.cycleRunning = false;
    state.pauseDepth = 0;
  }
}
