import { create } from "zustand";

let runSeq = 0;

/**
 * Navbar Silence Alarm / System Reset click progress bar. A non-zero run id
 * means the 2s bar is playing; a new id restarts it. Shared so AutoPilot can
 * play the same animation as a manual click.
 */
export const useHeaderActionProgressStore = create((set) => ({
  silence: 0,
  reset: 0,

  start: (key) => {
    if (key !== "silence" && key !== "reset") return;
    runSeq += 1;
    set({ [key]: runSeq });
  },

  clear: (key) => {
    if (key !== "silence" && key !== "reset") return;
    set({ [key]: 0 });
  },
}));
