import fs from "fs";
import path from "path";

/** Tauri app identifier — primary AppData folder on Windows/macOS. */
export const DESKTOP_APP_ID = "com.vision365.desktop";
/** Older desktop:dev folder name. */
export const LEGACY_APP_NAME = "Vision365";

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

function roamingOrConfigRoot(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const platform = process.platform;

  if (platform === "win32") {
    return process.env.APPDATA || path.join(home, "AppData", "Roaming");
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return path.join(home, ".config");
}

/** Known Vision365 AppData roots (Tauri first, then legacy). */
export function listVision365AppDataRoots(): string[] {
  const base = roamingOrConfigRoot();
  const roots = [
    path.join(base, DESKTOP_APP_ID),
    path.join(base, LEGACY_APP_NAME),
  ];
  // De-dupe while preserving order.
  return [...new Set(roots.map((p) => path.resolve(p)))];
}

function directoryLooksPopulated(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir);
    return entries.some((name) => !name.startsWith("."));
  } catch {
    return false;
  }
}

function mongoDataLooksPresent(root: string): boolean {
  return directoryLooksPopulated(path.join(root, "database", "mongodb"));
}

function floorPlansLookPresent(root: string): boolean {
  return directoryLooksPopulated(path.join(root, "floor-plans"));
}

/**
 * Resolve platform-specific app data directory.
 * Prefers %APPDATA%/com.vision365.desktop when it already has data
 * (installed desktop app), otherwise creates/uses that canonical folder.
 */
export function resolveAppDataPath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.VISION365_APP_DATA) return process.env.VISION365_APP_DATA;

  const roots = listVision365AppDataRoots();
  const desktopRoot = roots[0];
  const legacyRoot = roots[1];

  // Prefer the Tauri folder when it already has mongo or floor-plans.
  if (
    desktopRoot &&
    (mongoDataLooksPresent(desktopRoot) || floorPlansLookPresent(desktopRoot))
  ) {
    return desktopRoot;
  }

  // Fall back to legacy Vision365 if that is where data lives.
  if (
    legacyRoot &&
    (mongoDataLooksPresent(legacyRoot) || floorPlansLookPresent(legacyRoot))
  ) {
    return legacyRoot;
  }

  // Default for new installs: Tauri identifier folder.
  return desktopRoot || path.join(roamingOrConfigRoot(), DESKTOP_APP_ID);
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

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else if (entry.isFile()) {
      if (!fs.existsSync(to)) {
        fs.copyFileSync(from, to);
      }
    }
  }
}

/**
 * If the active AppData floor-plans folder is empty, copy images from
 * %APPDATA%/com.vision365.desktop (or legacy Vision365) when present.
 */
export function ensureFloorPlansFromDesktopApp(appDataPath: string): void {
  const dest = path.join(appDataPath, "floor-plans");
  if (directoryLooksPopulated(dest)) return;

  for (const root of listVision365AppDataRoots()) {
    if (path.resolve(root) === path.resolve(appDataPath)) continue;
    const src = path.join(root, "floor-plans");
    if (!directoryLooksPopulated(src)) continue;
    try {
      console.log(`[storage] Copying floor-plans from ${src} → ${dest}`);
      copyDirRecursive(src, dest);
      return;
    } catch (error) {
      console.warn(
        `[storage] Could not copy floor-plans from ${src}: ${(error as Error).message}`,
      );
    }
  }
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
