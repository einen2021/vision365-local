import { create } from "zustand";
import { persist } from "zustand/middleware";

/** User preference — whether trouble / supervisory popup alerts are shown. */
export const usePanelAlertSettingsStore = create(
  persist(
    (set, get) => ({
      troubleModalEnabled: true,
      supervisoryModalEnabled: true,

      setTroubleModalEnabled: (enabled) =>
        set({ troubleModalEnabled: enabled !== false }),

      setSupervisoryModalEnabled: (enabled) =>
        set({ supervisoryModalEnabled: enabled !== false }),

      isTroubleModalEnabled: () => get().troubleModalEnabled !== false,

      isSupervisoryModalEnabled: () => get().supervisoryModalEnabled !== false,
    }),
    { name: "vision365-panel-alert-settings" },
  ),
);
