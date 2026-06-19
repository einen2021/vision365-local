import fs from "fs";
import { type AppPaths } from "./storageService";
import { getCollection } from "../db/client";

export interface AppSettings {
  theme: "light" | "dark" | "system";
  language: string;
  notifications: {
    enabled: boolean;
    alarms: boolean;
    reminders: boolean;
  };
  window: {
    width: number;
    height: number;
    x: number | null;
    y: number | null;
    maximized: boolean;
  };
  backup: {
    autoBackup: boolean;
    intervalHours: number;
    lastBackupAt: string | null;
  };
  recentlyOpened: string[];
  rememberLogin: boolean;
  autoLogin: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: "system",
  language: "en",
  notifications: { enabled: true, alarms: true, reminders: true },
  window: { width: 1280, height: 800, x: null, y: null, maximized: false },
  backup: { autoBackup: false, intervalHours: 24, lastBackupAt: null },
  recentlyOpened: [],
  rememberLogin: false,
  autoLogin: false,
};

export function loadSettings(paths: AppPaths): AppSettings {
  try {
    if (fs.existsSync(paths.settingsFile)) {
      const raw = fs.readFileSync(paths.settingsFile, "utf-8");
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // Fall through to defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(
  paths: AppPaths,
  settings: Partial<AppSettings>
): Promise<AppSettings> {
  const current = loadSettings(paths);
  const merged = { ...current, ...settings };
  fs.writeFileSync(paths.settingsFile, JSON.stringify(merged, null, 2), "utf-8");

  const collection = getCollection("settings");
  const now = new Date().toISOString();
  await collection.updateOne(
    { key: "app_settings" },
    { $set: { key: "app_settings", value: JSON.stringify(merged), updated_at: now } },
    { upsert: true }
  );

  return merged;
}

export function getSetting<K extends keyof AppSettings>(
  paths: AppPaths,
  key: K
): AppSettings[K] {
  return loadSettings(paths)[key];
}

export async function setSetting<K extends keyof AppSettings>(
  paths: AppPaths,
  key: K,
  value: AppSettings[K]
): Promise<void> {
  const settings = loadSettings(paths);
  settings[key] = value;
  await saveSettings(paths, settings);
}
