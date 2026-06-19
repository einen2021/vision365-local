import { create } from "zustand";
import { persist } from "zustand/middleware";
import { apiPost, apiFetch } from "@/lib/apiClient";
import { isDesktop } from "@/lib/platform";

export interface DesktopSettings {
  theme: "light" | "dark" | "system";
  language: string;
  notifications: {
    enabled: boolean;
    alarms: boolean;
    reminders: boolean;
  };
  rememberLogin: boolean;
  autoLogin: boolean;
  recentlyOpened: string[];
}

interface SettingsState {
  settings: DesktopSettings;
  isLoaded: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (partial: Partial<DesktopSettings>) => Promise<void>;
  addRecentlyOpened: (path: string) => void;
}

const DEFAULT_SETTINGS: DesktopSettings = {
  theme: "system",
  language: "en",
  notifications: { enabled: true, alarms: true, reminders: true },
  rememberLogin: false,
  autoLogin: false,
  recentlyOpened: [],
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: DEFAULT_SETTINGS,
      isLoaded: false,

      loadSettings: async () => {
        if (!isDesktop()) {
          set({ isLoaded: true });
          return;
        }
        try {
          const res = await apiFetch("/api/settings");
          if (res.ok) {
            const data = await res.json();
            set({ settings: { ...DEFAULT_SETTINGS, ...data.settings }, isLoaded: true });
          } else {
            set({ isLoaded: true });
          }
        } catch {
          set({ isLoaded: true });
        }
      },

      updateSettings: async (partial) => {
        const merged = { ...get().settings, ...partial };
        set({ settings: merged });
        if (isDesktop()) {
          try {
            await apiPost("/api/settings", { settings: merged });
          } catch {
            // Settings saved locally via persist middleware
          }
        }
      },

      addRecentlyOpened: (path) => {
        const current = get().settings.recentlyOpened.filter((p) => p !== path);
        const updated = [path, ...current].slice(0, 10);
        get().updateSettings({ recentlyOpened: updated });
      },
    }),
    {
      name: "vision365-settings",
      partialize: (state) => ({ settings: state.settings }),
    }
  )
);
