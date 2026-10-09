import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX_HISTORY = 20;
const MAX_NOTICES = 50;
let noticeSeq = 0;

/** Step ids, in run order. "disable" only runs for fire when the option is on. */
export const AUTOPILOT_STEPS = [
  { id: "ack", label: "Acknowledge" },
  { id: "confirm", label: "Panel confirmed" },
  { id: "silence", label: "Silence alarm" },
  { id: "reset", label: "System reset" },
  { id: "disable", label: "Turn off fire device" },
];

/**
 * AutoPilot settings (persisted) and live run state (not persisted).
 * The runner itself lives in components/autopilot-controller.jsx.
 */
export const useAutoPilotStore = create(
  persist(
    (set, get) => ({
      // ── Settings ───────────────────────────────────────────────────────
      enabled: false,
      disableFireDevice: false,

      setEnabled: (enabled) => set({ enabled: Boolean(enabled) }),
      setDisableFireDevice: (value) => set({ disableFireDevice: Boolean(value) }),

      // ── Live state ─────────────────────────────────────────────────────
      /** Run in progress: { id, label, locations, startedAt, steps: { [id]: step } } */
      currentRun: null,
      /** Finished runs, newest first. */
      history: [],
      /** Labels waiting for a run, with their oldest arrival time. */
      queue: [],
      /** When AutoPilot last sent `ack` per category (epoch ms). */
      lastAckAt: { Fire: 0, Trouble: 0, Supervisory: 0 },

      setQueue: (queue) => set({ queue }),

      startRun: (run) => set({ currentRun: run }),

      updateStep: (runId, stepId, patch) =>
        set((state) => {
          if (state.currentRun?.id !== runId) return state;
          const prev = state.currentRun.steps[stepId] || {};
          return {
            currentRun: {
              ...state.currentRun,
              steps: { ...state.currentRun.steps, [stepId]: { ...prev, ...patch } },
            },
          };
        }),

      finishRun: (runId, outcome) =>
        set((state) => {
          if (state.currentRun?.id !== runId) return state;
          const finished = { ...state.currentRun, ...outcome, finishedAt: Date.now() };
          return {
            currentRun: null,
            history: [finished, ...state.history].slice(0, MAX_HISTORY),
          };
        }),

      clearHistory: () => set({ history: [] }),

      /** Dismissible AutoPilot notices (newest last). tone: fire | trouble | supervisory | success | error */
      notices: [],

      pushNotice: ({ tone = "success", title, description = "" }) => {
        noticeSeq += 1;
        const notice = { id: `${Date.now()}-${noticeSeq}`, tone, title, description, at: Date.now() };
        set((state) => ({ notices: [...state.notices, notice].slice(-MAX_NOTICES) }));
      },

      dismissNotice: (id) =>
        set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) })),

      dismissAllNotices: () => set({ notices: [] }),

      /**
       * True while an AutoPilot run is sending ack / login / set: list dumps
       * would make the panel ignore the typed login, so list re-syncs wait.
       */
      holdListDumps: false,
      setHoldListDumps: (hold) => set({ holdListDumps: Boolean(hold) }),

      markAcknowledged: (label, at = Date.now()) =>
        set((state) => ({ lastAckAt: { ...state.lastAckAt, [label]: at } })),

      /** True when AutoPilot already sent `ack` for this category at/after receivedAt. */
      wasAcknowledgedSince: (label, receivedAt) => {
        const at = Number(receivedAt);
        if (!at) return false;
        return Number(get().lastAckAt[label] || 0) >= at;
      },
    }),
    {
      name: "vision365-autopilot-settings",
      partialize: (state) => ({
        enabled: state.enabled,
        disableFireDevice: state.disableFireDevice,
      }),
    },
  ),
);

/**
 * Wait (up to maxMs) while AutoPilot holds list dumps. Resolves at once when
 * AutoPilot is not running a sequence.
 */
export async function waitForAutoPilotListHold(maxMs = 30000) {
  const end = Date.now() + maxMs;
  while (useAutoPilotStore.getState().holdListDumps && Date.now() < end) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
