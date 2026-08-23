import { create } from "zustand";

export const useStartupProgressStore = create((set) => ({
  step: 1,
  total: 12,
  percent: 0,
  message: "Starting Vision365...",
  isComplete: false,
  isSplashOpen: true,

  setProgress: (update) =>
    set((state) => ({
      step: update.step !== undefined ? update.step : state.step,
      total: update.total !== undefined ? update.total : state.total,
      percent: update.percent !== undefined ? update.percent : state.percent,
      message: update.message !== undefined ? update.message : state.message,
    })),

  closeSplash: () =>
    set({
      step: 12,
      total: 12,
      percent: 100,
      message: "Application ready",
      isComplete: true,
      isSplashOpen: false,
    }),
}));
