/**
 * Automatic JSON backups of the Firestore-style db_snapshot.
 * Survives Mongo wipes / empty reseeds and can restore communities + assets.
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

/** Minimum time between automatic backups (keeps write path fast). */
const BACKUP_THROTTLE_MS = 30_000;

let pendingBackupData: DbRecord | null = null;
let backupFlushTimer: ReturnType<typeof setTimeout> | null = null;
let backupInFlight = false;
let lastBackupAt = 0;

/**
 * Queue a backup off the DB write path.
 * JSON.stringify of a large AssetsList must not block every setDoc/batch.
 */
export function queueDbSnapshotBackup(data: DbRecord): void {
  if (countProductiveData(data).score === 0) return;
  // Keep latest object only — readDb returns a fresh copy each write.
  pendingBackupData = data;
  if (backupFlushTimer || backupInFlight) return;

  const wait = Math.max(0, BACKUP_THROTTLE_MS - (Date.now() - lastBackupAt));
  backupFlushTimer = setTimeout(() => {
    backupFlushTimer = null;
    void flushQueuedBackup();
  }, wait);
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
    // New writes arrived while we were saving — schedule another pass.
    if (pendingBackupData && !backupFlushTimer) {
      backupFlushTimer = setTimeout(() => {
        backupFlushTimer = null;
        void flushQueuedBackup();
      }, BACKUP_THROTTLE_MS);
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

/** Async variant used by the write-path queue so Mongo updates stay responsive. */
export async function saveDbSnapshotBackupAsync(
  data: DbRecord,
  appDataPath = resolveAppDataPath(),
): Promise<string | null> {
  const stats = countProductiveData(data);
  if (stats.score === 0) return null;

  const dir = snapshotsDir(appDataPath);
  // stringify off the hot withDb lock (caller already released it).
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

/** Best available JSON backup with the most productive data. */
export function findBestDbSnapshotBackup(
  appDataPath = resolveAppDataPath(),
): { path: string; data: DbRecord; score: number } | null {
  const searchRoots = [
    appDataPath,
    ...listVision365AppDataRoots(),
  ].filter((root, index, all) =>
    Boolean(root) &&
    all.findIndex((item) => path.resolve(item) === path.resolve(root)) === index,
  );

  const candidates: string[] = [];

  for (const root of searchRoots) {
    const dir = snapshotsDir(root);
    const latest = path.join(dir, LATEST_NAME);
    if (fs.existsSync(latest)) candidates.push(latest);

    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(".json")) continue;
        const full = path.join(dir, name);
        if (full === latest) continue;
        candidates.push(full);
      }
    } catch {
      // ignore missing dirs
    }

    // Also accept a manually placed recovery file in backups/.
    const paths = initAppDirectories(root);
    for (const name of [
      "recovered_snapshot.json",
      "db_snapshot_latest.json",
      "manual_restore.json",
    ]) {
      const full = path.join(paths.backups, name);
      if (fs.existsSync(full)) candidates.push(full);
    }
  }

  let best: { path: string; data: DbRecord; score: number } | null = null;
  for (const filePath of candidates) {
    const data = readSnapshotFile(filePath);
    if (!data) continue;
    const score = countProductiveData(data).score;
    if (score <= 0) continue;
    if (!best || score > best.score) {
      best = { path: filePath, data, score };
    }
  }

  return best;
}

/**
 * If the live DB looks empty but a JSON backup has communities/assets,
 * return that backup data for restore.
 */
export function maybeLoadRestoreSnapshot(
  liveData: DbRecord,
  appDataPath = resolveAppDataPath(),
): { data: DbRecord; path: string } | null {
  if (!isDbEssentiallyEmpty(liveData)) return null;

  const best = findBestDbSnapshotBackup(appDataPath);
  if (!best) return null;
  return { data: best.data, path: best.path };
}
