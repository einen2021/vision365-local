/** Coordinates pausing background panel command work around priority commands. */

/**
 * Keep session flags on globalThis so webpack/Tauri chunk splits cannot
 * duplicate this module and break pause coordination.
 */
function getSessionState() {
  const g = globalThis;
  if (!g.__vision365FirePanelMonitor) {
    g.__vision365FirePanelMonitor = {
      pauseDepth: 0,
      exclusiveCommandChain: Promise.resolve(),
      // Set while a foreground list dump (e.g. resolving an ambiguous fire
      // message location) must not be interleaved with anything else on the
      // telnet connection. See openPriorityGate/closePriorityGate below.
      priorityGate: null,
    };
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

/**
 * Pause background work, run a panel command, then resume this pause layer only.
 * Commands are serialized so two shows cannot interleave.
 */
export async function withMonitorPaused(fn) {
  const state = getSessionState();

  const run = state.exclusiveCommandChain.then(async () => {
    pauseMonitorLoop();
    try {
      return await fn();
    } finally {
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
 * Pause background work and run immediately — do NOT wait on the command chain.
 * Used for ack/silence/show where waiting behind a 200-row list dump is unacceptable.
 * The worker-side priority queue ensures the command jumps ahead of any in-flight list.
 *
 * Exception: while a priority gate is open (see openPriorityGate), the command is
 * held instead of running immediately. Repeated calls with the same commandKey
 * while the gate is open coalesce into a single queued run.
 */
export async function withMonitorPausedForPriority(fn, commandKey = null) {
  const state = getSessionState();
  const gate = state.priorityGate;

  if (gate) {
    const key = commandKey ?? fn;
    const existing = gate.queue.get(key);
    if (existing) return existing.promise;

    const entry = { fn };
    entry.promise = new Promise((resolve, reject) => {
      entry.resolve = resolve;
      entry.reject = reject;
    });
    gate.queue.set(key, entry);
    return entry.promise;
  }

  pauseMonitorLoop();
  try {
    return await fn();
  } finally {
    resumeMonitorLoop();
  }
}

/**
 * Open a gate that defers ack/silence/reset/etc. priority commands (anything
 * going through withMonitorPausedForPriority) until closePriorityGate() runs
 * them, instead of letting them jump ahead as usual. Use around a foreground
 * list dump that must not be interleaved with other panel commands.
 */
export function openPriorityGate() {
  const state = getSessionState();
  const gate = { queue: new Map() };
  state.priorityGate = gate;
  return gate;
}

/**
 * Close a gate opened with openPriorityGate() and run everything that queued
 * up while it was open — once per distinct commandKey (same-key retries were
 * coalesced) — in the order first requested, serialized on the exclusive
 * command chain so they run one at a time, immediately after the gated work.
 */
export function closePriorityGate(gate) {
  const state = getSessionState();
  if (state.priorityGate !== gate) return;
  state.priorityGate = null;

  for (const entry of gate.queue.values()) {
    state.exclusiveCommandChain = state.exclusiveCommandChain
      .then(async () => {
        pauseMonitorLoop();
        try {
          entry.resolve(await entry.fn());
        } catch (err) {
          entry.reject(err);
        } finally {
          resumeMonitorLoop();
        }
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }
}
