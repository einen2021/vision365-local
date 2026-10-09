/**
 * Pause bookkeeping around foreground panel commands.
 *
 * Command ordering is owned by the desktop-server panel worker (ranked queue:
 * ack/login/set → list f → list t/s → show → console → cshow *, with list dumps
 * preempted and restarted for more urgent commands). The browser no longer
 * serializes commands itself — doing so made an ack wait behind any list dump
 * already awaiting on the client before it even reached the server.
 */

/**
 * Keep session flags on globalThis so webpack/Tauri chunk splits cannot
 * duplicate this module.
 */
function getSessionState() {
  const g = globalThis;
  if (!g.__vision365FirePanelMonitor) {
    g.__vision365FirePanelMonitor = { pauseDepth: 0 };
  }
  return g.__vision365FirePanelMonitor;
}

export function pauseMonitorLoop() {
  getSessionState().pauseDepth += 1;
}

export function resumeMonitorLoop() {
  const state = getSessionState();
  state.pauseDepth = Math.max(0, state.pauseDepth - 1);
}

/** Run a panel command with the pause layer held; the worker handles ordering. */
export async function withMonitorPaused(fn) {
  pauseMonitorLoop();
  try {
    return await fn();
  } finally {
    resumeMonitorLoop();
  }
}

export async function withMonitorPausedForPriority(fn) {
  return withMonitorPaused(fn);
}
