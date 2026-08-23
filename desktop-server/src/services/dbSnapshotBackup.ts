/**
 * Automatic JSON backups of the SQLite document store.
 * Survives empty reseeds and can restore communities + assets into SQLite.
 */

import fs from "fs";
import path from "path";
import { resolveAppDataPath, initAppDirectories, listVision365AppDataRoots } from "./storageService";

const LATEST_NAME = "db_snapshot_latest.json";
const MAX_ROTATING = 12;
const MIN_BACKUP_BYTES = 200;

type DbRecord = Record<string, unknown>;

function snapshotsDir(appDataPath = resolveAppDataPath()): string {
  const paths = initAppDirectories(appDataPath);
  const dir = path.join(paths.backups, "db-snapshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Read-only snapshot folder path — does not create directories. */
function snapshotsDirReadOnly(appDataPath: string): string {
  return path.join(appDataPath, "backups", "db-snapshots");
}

/** Rough “does this look like real building / asset data?” check. */
export function countProductiveData(data: DbRecord | null | undefined): {
  communities: number;
  assets: number;
  buildingDbs: number;
  score: number;
} {
  if (!data || typeof data !== "object") {
    return { communities: 0, assets: 0, buildingDbs: 0, score: 0 };
  }

  const communities =
    data.communities && typeof data.communities === "object"
      ? Object.keys(data.communities as object).length
      : 0;
  const assets =
    data.AssetsList && typeof data.AssetsList === "object"
      ? Object.keys(data.AssetsList as object).length
      : 0;
  const buildingDbs = Object.keys(data).filter((key) =>
    /BuildingDB$/i.test(key),
  ).length;

  return {
    communities,
    assets,
    buildingDbs,
    score: communities * 1000 + assets + buildingDbs * 100,
  };
}

export function isDbEssentiallyEmpty(data: DbRecord | null | undefined): boolean {
  return countProductiveData(data).score === 0;
}

function parseSnapshotTimestamp(filename: string, mtimeMs: number): number {
  const match = filename.match(/db_snapshot_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z?\.json$/i);
  if (match) {
    const [_, datePart, hh, mm, ss, ms] = match;
    const isoString = `${datePart}T${hh}:${mm}:${ss}${ms ? `.${ms}` : ".000"}Z`;
    const parsed = Date.parse(isoString);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return mtimeMs;
}

/** Minimum debounce time for writes before saving snapshot (ms). */
const BACKUP_DEBOUNCE_MS = 1000;

let pendingBackupData: DbRecord | null = null;
let backupFlushTimer: NodeJS.Timeout | null = null;
let backupInFlight = false;
let lastBackupAt = 0;

/**
 * Queue a backup off the DB write path so SQLite updates stay fast.
 * Saves latest snapshot to AppData/Roaming/com.vision365.desktop backups.
 */
export function queueDbSnapshotBackup(data: DbRecord): void {
  if (countProductiveData(data).score === 0) return;
  pendingBackupData = data;

  if (backupFlushTimer) {
    clearTimeout(backupFlushTimer);
    backupFlushTimer = null;
  }

  backupFlushTimer = setTimeout(() => {
    backupFlushTimer = null;
    void flushQueuedBackup();
  }, BACKUP_DEBOUNCE_MS);
}

/** Flush any pending backup immediately (e.g. on shutdown). */
export function flushPendingDbSnapshotBackup(appDataPath = resolveAppDataPath()): void {
  if (backupFlushTimer) {
    clearTimeout(backupFlushTimer);
    backupFlushTimer = null;
  }
  if (pendingBackupData) {
    const data = pendingBackupData;
    pendingBackupData = null;
    try {
      saveDbSnapshotBackup(data, appDataPath);
    } catch (err) {
      console.warn("[db] Synchronous snapshot backup flush failed:", (err as Error).message);
    }
  }
}

async function flushQueuedBackup(): Promise<void> {
  if (backupInFlight) return;
  const data = pendingBackupData;
  pendingBackupData = null;
  if (!data) return;

  backupInFlight = true;
  try {
    await saveDbSnapshotBackupAsync(data);
    lastBackupAt = Date.now();
  } catch (error) {
    console.warn("[db] queued snapshot backup failed:", (error as Error).message);
  } finally {
    backupInFlight = false;
    if (pendingBackupData && !backupFlushTimer) {
      backupFlushTimer = setTimeout(() => {
        backupFlushTimer = null;
        void flushQueuedBackup();
      }, BACKUP_DEBOUNCE_MS);
    }
  }
}

/** Write rotating JSON snapshot when the DB has real content (sync, for restore path). */
export function saveDbSnapshotBackup(
  data: DbRecord,
  appDataPath = resolveAppDataPath(),
): string | null {
  const stats = countProductiveData(data);
  if (stats.score === 0) return null;

  const dir = snapshotsDir(appDataPath);
  const payload = JSON.stringify(data);
  if (payload.length < MIN_BACKUP_BYTES) return null;

  const latestPath = path.join(dir, LATEST_NAME);
  fs.writeFileSync(latestPath, payload, "utf-8");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rotatingPath = path.join(dir, `db_snapshot_${stamp}.json`);
  fs.writeFileSync(rotatingPath, payload, "utf-8");

  pruneOldSnapshots(dir);
  lastBackupAt = Date.now();
  return latestPath;
}

/** Async variant used by the write-path queue so SQLite updates stay responsive. */
export async function saveDbSnapshotBackupAsync(
  data: DbRecord,
  appDataPath = resolveAppDataPath(),
): Promise<string | null> {
  const stats = countProductiveData(data);
  if (stats.score === 0) return null;

  const dir = snapshotsDir(appDataPath);
  const payload = JSON.stringify(data);
  if (payload.length < MIN_BACKUP_BYTES) return null;

  const latestPath = path.join(dir, LATEST_NAME);
  await fs.promises.writeFile(latestPath, payload, "utf-8");

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const rotatingPath = path.join(dir, `db_snapshot_${stamp}.json`);
  await fs.promises.writeFile(rotatingPath, payload, "utf-8");

  pruneOldSnapshots(dir);
  return latestPath;
}

function pruneOldSnapshots(dir: string) {
  const files = fs
    .readdirSync(dir)
    .filter((name) => /^db_snapshot_\d{4}-.+\.json$/i.test(name))
    .map((name) => {
      const full = path.join(dir, name);
      return { full, mtime: fs.statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);

  for (const stale of files.slice(MAX_ROTATING)) {
    try {
      fs.unlinkSync(stale.full);
    } catch {
      // ignore
    }
  }
}

function readSnapshotFile(filePath: string): DbRecord | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as DbRecord;
  } catch {
    return null;
  }
}

export interface CandidateSnapshot {
  path: string;
  data: DbRecord;
  score: number;
  timestamp: number;
  isPrimary: boolean;
}

/**
 * Find all available JSON backups, prioritized by AppData/Roaming/com.vision365.desktop
 * and sorted by latest timestamp.
 */
export function listAllDbSnapshotBackups(
  appDataPath = resolveAppDataPath(),
): CandidateSnapshot[] {
  const primaryRoot = resolveAppDataPath();
  const searchRoots = [
    primaryRoot,
    appDataPath,
    ...listVision365AppDataRoots(),
  ].filter((root, index, all) =>
    Boolean(root) &&
    all.findIndex((item) => path.resolve(item) === path.resolve(root)) === index,
  );

  const candidates: { path: string; isPrimary: boolean; timestamp: number }[] = [];
  const seenPaths = new Set<string>();

  for (const root of searchRoots) {
    if (!fs.existsSync(root)) continue;
    const isPrimary = path.resolve(root) === path.resolve(primaryRoot);

    const dir = snapshotsDirReadOnly(root);
    const latest = path.join(dir, LATEST_NAME);
    if (fs.existsSync(latest)) {
      try {
        const stat = fs.statSync(latest);
        const resolved = path.resolve(latest);
        if (!seenPaths.has(resolved)) {
          seenPaths.add(resolved);
          candidates.push({
            path: latest,
            isPrimary,
            timestamp: stat.mtimeMs,
          });
        }
      } catch {}
    }

    try {
      if (fs.existsSync(dir)) {
        for (const name of fs.readdirSync(dir)) {
          if (!name.endsWith(".json")) continue;
          const full = path.join(dir, name);
          const resolved = path.resolve(full);
          if (seenPaths.has(resolved)) continue;
          seenPaths.add(resolved);
          try {
            const stat = fs.statSync(full);
            candidates.push({
              path: full,
              isPrimary,
              timestamp: parseSnapshotTimestamp(name, stat.mtimeMs),
            });
          } catch {}
        }
      }
    } catch {
      // ignore missing dirs
    }

    // Also accept manually placed recovery files in backups/.
    const backupsRoot = path.join(root, "backups");
    for (const name of [
      "recovered_snapshot.json",
      "db_snapshot_latest.json",
      "manual_restore.json",
    ]) {
      const full = path.join(backupsRoot, name);
      if (fs.existsSync(full)) {
        const resolved = path.resolve(full);
        if (seenPaths.has(resolved)) continue;
        seenPaths.add(resolved);
        try {
          const stat = fs.statSync(full);
          candidates.push({
            path: full,
            isPrimary,
            timestamp: stat.mtimeMs,
          });
        } catch {}
      }
    }
  }

  const results: CandidateSnapshot[] = [];
  for (const c of candidates) {
    const data = readSnapshotFile(c.path);
    if (!data) continue;
    const score = countProductiveData(data).score;
    if (score <= 0) continue;
    results.push({
      path: c.path,
      data,
      score,
      timestamp: c.timestamp,
      isPrimary: c.isPrimary,
    });
  }

  // Sort: primary AppData root first, then newest timestamp descending, then score descending.
  results.sort((a, b) => {
    if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
    if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
    return b.score - a.score;
  });

  return results;
}

/** Always use the latest backup from AppData/Roaming/com.vision365.desktop backups */
export function findLatestDbSnapshotBackup(
  appDataPath = resolveAppDataPath(),
): CandidateSnapshot | null {
  const list = listAllDbSnapshotBackups(appDataPath);
  return list.length > 0 ? list[0] : null;
}

/** Backward compatibility alias for findLatestDbSnapshotBackup */
export function findBestDbSnapshotBackup(
  appDataPath = resolveAppDataPath(),
): CandidateSnapshot | null {
  return findLatestDbSnapshotBackup(appDataPath);
}

/**
 * If the live DB looks empty but a JSON backup has communities/assets,
 * return that latest backup data for restore.
 */
export function maybeLoadRestoreSnapshot(
  liveData: DbRecord,
  appDataPath = resolveAppDataPath(),
): { data: DbRecord; path: string } | null {
  if (!isDbEssentiallyEmpty(liveData)) return null;

  const latest = findLatestDbSnapshotBackup(appDataPath);
  if (!latest) return null;
  return { data: latest.data, path: latest.path };
}
