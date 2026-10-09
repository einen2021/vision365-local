import fs from "fs";
import path from "path";

/** Tauri app identifier — primary AppData folder (canonical write target). */
export const DESKTOP_APP_ID = "com.vision365.desktop";
/** Alternate spelling some installs / older builds used. */
export const DESKTOP_APP_ID_HYPHEN = "com.vision365-desktop";
/** Older desktop:dev folder name. */
export const LEGACY_APP_NAME = "Vision365";

export interface AppPaths {
  root: string;
  database: string;
  /** Path to vision365.db (SQLite). */
  sqliteFile: string;
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

function roamingRoot(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "win32") {
    return process.env.APPDATA || path.join(home, "AppData", "Roaming");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support");
  }
  return path.join(home, ".config");
}

/** Windows Local AppData (and Linux/macOS equivalents). */
function localRoot(): string {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Caches");
  }
  return path.join(home, ".local", "share");
}

const APP_FOLDER_NAMES = [
  DESKTOP_APP_ID,
  DESKTOP_APP_ID_HYPHEN,
  LEGACY_APP_NAME,
];

/**
 * Every known Vision365 data folder we should scan for backups / floor-plans.
 * Includes Roaming + Local, dotted + hyphen ids, and legacy Vision365.
 */
export function listVision365AppDataRoots(): string[] {
  const bases = [roamingRoot(), localRoot()];
  const roots: string[] = [];

  for (const base of bases) {
    for (const name of APP_FOLDER_NAMES) {
      roots.push(path.join(base, name));
    }
  }

  // De-dupe while preserving order.
  return [...new Set(roots.map((p) => path.resolve(p)))];
}

export function directoryLooksPopulated(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) return false;
    const entries = fs.readdirSync(dir);
    return entries.some((name) => !name.startsWith("."));
  } catch {
    return false;
  }
}

function sqliteLooksPresent(root: string): boolean {
  const file = path.join(root, "database", "vision365.db");
  try {
    return fs.existsSync(file) && fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function snapshotBackupLooksPresent(root: string): boolean {
  const dir = path.join(root, "backups", "db-snapshots");
  if (fs.existsSync(path.join(dir, "db_snapshot_latest.json.gz"))) return true;
  if (fs.existsSync(path.join(dir, "db_snapshot_latest.json"))) return true;
  return directoryLooksPopulated(path.join(root, "backups", "db-snapshots"));
}

function floorPlansLookPresent(root: string): boolean {
  return directoryLooksPopulated(path.join(root, "floor-plans"));
}

function rootLooksLikeExistingInstall(root: string): boolean {
  return (
    sqliteLooksPresent(root) ||
    snapshotBackupLooksPresent(root) ||
    floorPlansLookPresent(root) ||
    directoryLooksPopulated(path.join(root, "uploads")) ||
    directoryLooksPopulated(path.join(root, "database", "mongodb"))
  );
}

/**
 * Resolve platform-specific app data directory (canonical write target).
 * Prefer Roaming com.vision365.desktop when it already has data.
 */
export function resolveAppDataPath(customPath?: string): string {
  if (customPath) return customPath;
  if (process.env.VISION365_APP_DATA) return process.env.VISION365_APP_DATA;

  const roots = listVision365AppDataRoots();
  const preferred = path.join(roamingRoot(), DESKTOP_APP_ID);

  // Prefer the canonical Tauri folder when it already has data.
  if (rootLooksLikeExistingInstall(preferred)) {
    return preferred;
  }

  // Otherwise use the first root that already has backups / floor-plans / uploads.
  for (const root of roots) {
    if (root && rootLooksLikeExistingInstall(root)) {
      return root;
    }
  }

  return preferred;
}

/** Initialize all required app data directories */
export function initAppDirectories(appDataPath: string): AppPaths {
  const paths: AppPaths = {
    root: appDataPath,
    database: path.join(appDataPath, "database"),
    sqliteFile: path.join(appDataPath, "database", "vision365.db"),
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
    // Skip file paths (settings.json, vision365.db) — only create directories.
    if (dir.endsWith(".json") || dir.endsWith(".db")) continue;
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.mkdirSync(paths.database, { recursive: true });
  fs.mkdirSync(paths.settings, { recursive: true });

  return paths;
}

/** Files the storage cleanup removed (paths relative to the AppData root). */
const REMOVED_FILES_NAME = "storage-cleanup-removed.json";

export function readRemovedFiles(appDataPath: string): Set<string> {
  try {
    const list = JSON.parse(
      fs.readFileSync(path.join(appDataPath, REMOVED_FILES_NAME), "utf-8"),
    );
    return new Set(Array.isArray(list) ? list.map(String) : []);
  } catch {
    return new Set();
  }
}

/** Remember removed files so the legacy-folder import never copies them back. */
export function recordRemovedFiles(appDataPath: string, absolutePaths: string[]): void {
  if (absolutePaths.length === 0) return;
  const removed = readRemovedFiles(appDataPath);
  for (const abs of absolutePaths) {
    removed.add(path.relative(appDataPath, abs).replace(/\\/g, "/"));
  }
  try {
    fs.writeFileSync(
      path.join(appDataPath, REMOVED_FILES_NAME),
      JSON.stringify([...removed]),
      "utf-8",
    );
  } catch {
    // ignore
  }
}

/**
 * Copy files from src → dest. Missing files are always added.
 * Existing files are left alone (no overwrite) unless overwrite=true.
 * `skip(destPath)` leaves out files that must not come back.
 * Returns how many files were newly copied.
 */
export function copyDirMerge(
  src: string,
  dest: string,
  options: { overwrite?: boolean; skip?: (destPath: string) => boolean } = {},
): number {
  if (!fs.existsSync(src)) return 0;
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copied += copyDirMerge(from, to, options);
    } else if (entry.isFile()) {
      if (options.skip?.(to)) continue;
      if (!fs.existsSync(to) || options.overwrite) {
        fs.copyFileSync(from, to);
        copied += 1;
      }
    }
  }

  return copied;
}

/**
 * On startup: pull floor-plans, uploads, settings, and JSON snapshot backups
 * from every known AppData location (Roaming + Local, hyphen + dotted ids).
 * Always merges missing files so a half-filled dest still gets the rest.
 */
export function importLegacyAppDataAssets(appDataPath: string): {
  floorPlans: number;
  uploads: number;
  settings: boolean;
  snapshots: number;
  sourcesChecked: string[];
} {
  const dest = initAppDirectories(appDataPath);
  const sourcesChecked: string[] = [];
  let floorPlans = 0;
  let uploads = 0;
  let settings = false;
  let snapshots = 0;

  // Files the storage cleanup deleted must not be copied back in.
  const removed = readRemovedFiles(appDataPath);
  const skip = (destPath: string) =>
    removed.has(path.relative(appDataPath, destPath).replace(/\\/g, "/"));
  // Restore-when-empty already reads backups from every root in place, so
  // only copy snapshots when this install has none of its own.
  const snapDestDir = path.join(dest.backups, "db-snapshots");
  const hasOwnSnapshot =
    fs.existsSync(snapDestDir) &&
    fs.readdirSync(snapDestDir).some((name) => /\.json(\.gz)?$/i.test(name));

  for (const root of listVision365AppDataRoots()) {
    if (!fs.existsSync(root)) continue;
    if (path.resolve(root) === path.resolve(appDataPath)) continue;
    sourcesChecked.push(root);

    // Floor plan images / DXF / nested floor folders
    const floorSrc = path.join(root, "floor-plans");
    if (directoryLooksPopulated(floorSrc)) {
      const n = copyDirMerge(floorSrc, dest.floorPlans, { skip });
      if (n > 0) {
        console.log(`[storage] Copied ${n} floor-plan file(s) from ${floorSrc}`);
        floorPlans += n;
      }
    }

    // Uploaded images / videos / documents
    const uploadsSrc = path.join(root, "uploads");
    if (directoryLooksPopulated(uploadsSrc)) {
      const n = copyDirMerge(uploadsSrc, dest.uploads, { skip });
      if (n > 0) {
        console.log(`[storage] Copied ${n} upload file(s) from ${uploadsSrc}`);
        uploads += n;
      }
    }

    // Settings file (only if active install has none)
    const settingsSrc = path.join(root, "settings", "settings.json");
    if (!fs.existsSync(dest.settingsFile) && fs.existsSync(settingsSrc)) {
      fs.mkdirSync(dest.settings, { recursive: true });
      fs.copyFileSync(settingsSrc, dest.settingsFile);
      console.log(`[storage] Copied settings from ${settingsSrc}`);
      settings = true;
    }

    // JSON DB snapshots → active backups/db-snapshots (for SQLite import)
    const snapSrc = path.join(root, "backups", "db-snapshots");
    const snapDest = path.join(dest.backups, "db-snapshots");
    if (!hasOwnSnapshot && directoryLooksPopulated(snapSrc)) {
      fs.mkdirSync(snapDest, { recursive: true });
      const n = copyDirMerge(snapSrc, snapDest);
      if (n > 0) {
        console.log(`[storage] Copied ${n} DB snapshot file(s) from ${snapSrc}`);
        snapshots += n;
      }
    }

    // Manual recovery JSON sitting directly under backups/
    for (const name of [
      "recovered_snapshot.json",
      "db_snapshot_latest.json",
      "manual_restore.json",
    ]) {
      const from = path.join(root, "backups", name);
      const to = path.join(dest.backups, name);
      if (fs.existsSync(from) && !fs.existsSync(to)) {
        fs.copyFileSync(from, to);
        snapshots += 1;
        console.log(`[storage] Copied recovery snapshot ${from}`);
      }
    }
  }

  if (sourcesChecked.length > 0) {
    console.log(
      `[storage] Legacy import scanned ${sourcesChecked.length} AppData root(s); ` +
        `floorPlans=+${floorPlans}, uploads=+${uploads}, snapshots=+${snapshots}`,
    );
  }

  return { floorPlans, uploads, settings, snapshots, sourcesChecked };
}

/**
 * If the active AppData floor-plans folder is empty/missing files,
 * copy from Roaming/Local com.vision365-desktop and other known roots.
 */
export function ensureFloorPlansFromDesktopApp(appDataPath: string): void {
  const result = importLegacyAppDataAssets(appDataPath);
  if (result.floorPlans === 0 && !directoryLooksPopulated(path.join(appDataPath, "floor-plans"))) {
    console.warn(
      "[storage] No floor-plans found under Roaming/Local " +
        "com.vision365-desktop, com.vision365.desktop, or Vision365.",
    );
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
