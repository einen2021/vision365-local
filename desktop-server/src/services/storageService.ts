import fs from "fs";
import path from "path";

/** Tauri app identifier — AppData folder used by the installed desktop app. */
const TAURI_APP_ID = "com.vision365.desktop";
/** Older desktop:dev / early builds used this folder name. */
const LEGACY_APP_NAME = "Vision365";

export interface AppPaths {
  root: string;
  database: string;
  mongoData: string;
  uploads: string;
  images: string;
  videos: string;
  documents: string;
  audio: string;
  temp: string;
  floorPlans: string;
  backups: string;
  exports: string;
  settings: string;
  settingsFile: string;
  logs: string;
}

function platformAppDataRoot(folderName: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const platform = process.platform;

  if (platform === "win32") {
    const appData = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(appData, folderName);
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", folderName);
  }
  return path.join(home, ".config", folderName);
}

/**
 * Resolve platform-specific app data directory.
 * Prefer the Tauri identifier folder (`com.vision365.desktop`) so desktop:dev
 * and the installed app share the same backups / uploads / database files.
 */
export function resolveAppDataPath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.VISION365_APP_DATA) return process.env.VISION365_APP_DATA;

  return platformAppDataRoot(TAURI_APP_ID);
}

/** Older %APPDATA%/Vision365 installs — used as a restore fallback. */
export function resolveLegacyAppDataPath(): string | null {
  const legacy = platformAppDataRoot(LEGACY_APP_NAME);
  if (!fs.existsSync(legacy)) return null;
  return legacy;
}

/**
 * All known app-data roots to search when restoring an empty DB
 * (current Tauri folder first, then legacy Vision365).
 */
export function resolveAppDataSearchRoots(primaryPath?: string): string[] {
  const primary = primaryPath || resolveAppDataPath();
  const roots = [primary];
  const legacy = resolveLegacyAppDataPath();
  if (legacy && path.resolve(legacy) !== path.resolve(primary)) {
    roots.push(legacy);
  }
  return roots;
}

/** Initialize all required app data directories */
export function initAppDirectories(appDataPath: string): AppPaths {
  const paths: AppPaths = {
    root: appDataPath,
    database: path.join(appDataPath, "database"),
    mongoData: path.join(appDataPath, "database", "mongodb"),
    uploads: path.join(appDataPath, "uploads"),
    images: path.join(appDataPath, "uploads", "images"),
    videos: path.join(appDataPath, "uploads", "videos"),
    documents: path.join(appDataPath, "uploads", "documents"),
    audio: path.join(appDataPath, "uploads", "audio"),
    temp: path.join(appDataPath, "uploads", "temp"),
    floorPlans: path.join(appDataPath, "floor-plans"),
    backups: path.join(appDataPath, "backups"),
    exports: path.join(appDataPath, "exports"),
    settings: path.join(appDataPath, "settings"),
    settingsFile: path.join(appDataPath, "settings", "settings.json"),
    logs: path.join(appDataPath, "logs"),
  };

  for (const dir of Object.values(paths)) {
    if (dir.endsWith(".json")) continue;
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.mkdirSync(paths.database, { recursive: true });
  fs.mkdirSync(paths.settings, { recursive: true });

  return paths;
}

/** Prevent path traversal — ensures resolved path stays within base */
export function safePath(base: string, ...segments: string[]): string {
  const resolved = path.resolve(base, ...segments);
  const normalizedBase = path.resolve(base);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

const MIME_CATEGORIES: Record<string, string> = {
  "image/jpeg": "images",
  "image/png": "images",
  "image/webp": "images",
  "image/gif": "images",
  "video/mp4": "videos",
  "audio/mpeg": "audio",
  "audio/mp3": "audio",
  "application/pdf": "documents",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "documents",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "documents",
};

export function getCategoryForMime(mimeType: string, storagePath?: string): string {
  if (storagePath?.includes("floor-plans")) return "floor-plans";
  return MIME_CATEGORIES[mimeType] || "documents";
}

export const ALLOWED_MIME_TYPES = new Set(Object.keys(MIME_CATEGORIES));
export const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB
