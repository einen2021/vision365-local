/**
 * Automatic JSON backups of the SQLite document store.
 * Survives empty reseeds and can restore communities + assets into SQLite.
 *
 * Only ONE backup is kept: the latest snapshot, gzip-compressed
 * (db_snapshot_latest.json.gz, ~0.3 MB instead of ~5 MB). It is written to a
 * temp file and renamed into place, and only then are older snapshots
 * (rotating copies, uncompressed latest) deleted — a failed write never
 * leaves the app without a backup.
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { promisify } from "util";
import { resolveAppDataPath, initAppDirectories, listVision365AppDataRoots } from "./storageService";

const gzipAsync = promisify(zlib.gzip);

/** Older uncompressed latest — still read, replaced by LATEST_GZ_NAME. */
const LATEST_NAME = "db_snapshot_latest.json";
const LATEST_GZ_NAME = "db_snapshot_latest.json.gz";
const MIN_BACKUP_BYTES = 200;

/** Snapshot files this module reads (plain or gzip JSON). */
function isSnapshotFileName(name: string): boolean {
  return /\.json(\.gz)?$/i.test(name);
}

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
  const match = filename.match(/db_snapshot_(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z?\.json(?:\.gz)?$/i);
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

  const latestPath = path.join(dir, LATEST_GZ_NAME);
  const tmpPath = `${latestPath}.tmp`;
  fs.writeFileSync(tmpPath, zlib.gzipSync(payload));
  fs.renameSync(tmpPath, latestPath);

  removeOlderSnapshots(dir);
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

  const latestPath = path.join(dir, LATEST_GZ_NAME);
  const tmpPath = `${latestPath}.tmp`;
  // gzip runs on the libuv thread pool — the DB write path stays responsive.
  await fs.promises.writeFile(tmpPath, await gzipAsync(payload));
  await fs.promises.rename(tmpPath, latestPath);

  removeOlderSnapshots(dir);
  return latestPath;
}

/** Keep only the compressed latest snapshot; delete every other snapshot file. */
function removeOlderSnapshots(dir: string) {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name === LATEST_GZ_NAME) continue;
    if (!/^db_snapshot_.+\.json(\.gz)?(\.tmp)?$/i.test(name)) continue;
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      // ignore
    }
  }
}

/**
 * Startup: make sure the single compressed latest backup exists (converting
 * the newest older snapshot if needed), then delete all other snapshots.
 * Returns bytes freed.
 */
export function compactDbSnapshotBackups(appDataPath = resolveAppDataPath()): number {
  const dir = snapshotsDirReadOnly(appDataPath);
  if (!fs.existsSync(dir)) return 0;

  const sizeOf = () =>
    fs
      .readdirSync(dir)
      .reduce((sum, name) => sum + (fs.statSync(path.join(dir, name)).size || 0), 0);
  const before = sizeOf();

  if (!fs.existsSync(path.join(dir, LATEST_GZ_NAME))) {
    const latest = findLatestDbSnapshotBackup(appDataPath);
    if (!latest) return 0;
    // Writes the .gz first, then removes the older files.
    if (!saveDbSnapshotBackup(latest.data, appDataPath)) return 0;
  } else {
    removeOlderSnapshots(dir);
  }
  return Math.max(0, before - sizeOf());
}

/** Read a plain or gzip JSON snapshot. */
export function readSnapshotFile(filePath: string): DbRecord | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath);
    const text = /\.gz$/i.test(filePath) ? zlib.gunzipSync(raw).toString("utf-8") : raw.toString("utf-8");
    const parsed = JSON.parse(text);
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
    for (const latest of [path.join(dir, LATEST_GZ_NAME), path.join(dir, LATEST_NAME)]) {
      if (!fs.existsSync(latest)) continue;
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
          if (!isSnapshotFileName(name)) continue;
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
