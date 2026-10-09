/**
 * Startup storage cleanup for the AppData folder (runs on every install):
 *  1. Keep a single compressed DB snapshot backup (see dbSnapshotBackup).
 *  2. Drop tables no current code uses, then shrink the SQLite file.
 *  3. Delete uploaded floor plans / images no document refers to any more
 *     (re-uploads leave the old file behind). Files younger than a day are
 *     kept so an upload is never removed before its document is saved.
 *  4. Convert BMP floor plans to lossless PNG (often 20–40× smaller) and
 *     point their documents at the PNG.
 * Removed files are recorded so the legacy-folder import never restores them.
 */

import fs from "fs";
import path from "path";
import { getSqlite, withTransaction } from "../db/client";
import { invalidateDocumentsAfterDirectWrite, readDb } from "../db/documentStore";
import { serverLog } from "../log";
import { type AppPaths, recordRemovedFiles } from "./storageService";
import { compactDbSnapshotBackups, saveDbSnapshotBackup } from "./dbSnapshotBackup";
import { bmpToPng } from "./bmpToPng";

/** Tables from older versions — nothing reads or writes them now. */
const LEFTOVER_TABLES = ["telnet_logs", "panel_events", "panel_active_lists", "panel_alarm_history"];

/** Only remove unreferenced files older than this. */
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;
/** VACUUM only when at least this much space is free inside the DB file. */
const VACUUM_MIN_FREE_BYTES = 1024 * 1024;
/** Below this much document text the DB is new/empty — never treat files as orphans. */
const MIN_REFERENCE_TEXT = 10_000;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

/** Drop leftover tables, then VACUUM if the file has enough free space. */
function compactDatabase(sqliteFile: string): number {
  const db = getSqlite();
  const before = fileSize(sqliteFile) + fileSize(`${sqliteFile}-wal`);

  for (const table of LEFTOVER_TABLES) {
    db.exec(`DROP TABLE IF EXISTS "${table}"`);
  }

  const { freelist_count: freePages } = db.prepare("PRAGMA freelist_count").get() as {
    freelist_count: number;
  };
  const { page_size: pageSize } = db.prepare("PRAGMA page_size").get() as { page_size: number };
  if (freePages * pageSize >= VACUUM_MIN_FREE_BYTES) {
    db.exec("VACUUM");
  }
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");

  const after = fileSize(sqliteFile) + fileSize(`${sqliteFile}-wal`);
  return Math.max(0, before - after);
}

/** All text a stored file name could be referenced from. */
function collectReferenceText(paths: AppPaths): string {
  const db = getSqlite();
  const parts: string[] = [];
  for (const row of db.prepare("SELECT data FROM documents").all() as { data: string }[]) {
    parts.push(row.data);
  }
  try {
    for (const row of db.prepare("SELECT * FROM settings").all()) {
      parts.push(JSON.stringify(row));
    }
  } catch {
    // no settings table
  }
  try {
    parts.push(fs.readFileSync(paths.settingsFile, "utf-8"));
  } catch {
    // no settings file
  }
  return parts.join("\n");
}

function isReferenced(name: string, text: string): boolean {
  return text.includes(name) || text.includes(encodeURIComponent(name));
}

/** Delete unreferenced, day-old files under dir (recursively). */
function removeOrphanFiles(
  dir: string,
  text: string,
  skipDirs: Set<string>,
): { files: number; bytes: number; removed: string[] } {
  const result = { files: 0, bytes: 0, removed: [] as string[] };
  if (!fs.existsSync(dir)) return result;
  const now = Date.now();

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.has(path.resolve(full))) continue;
      const sub = removeOrphanFiles(full, text, skipDirs);
      result.files += sub.files;
      result.bytes += sub.bytes;
      result.removed.push(...sub.removed);
      continue;
    }
    if (!entry.isFile() || isReferenced(entry.name, text)) continue;
    try {
      const stat = fs.statSync(full);
      if (now - stat.mtimeMs < ORPHAN_MIN_AGE_MS) continue;
      fs.unlinkSync(full);
      result.files += 1;
      result.bytes += stat.size;
      result.removed.push(full);
    } catch {
      // ignore
    }
  }
  return result;
}

function listFiles(dir: string, skipDirs: Set<string>, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skipDirs.has(path.resolve(full))) listFiles(full, skipDirs, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** Replace every reference to `from` (plain or URL-encoded) with `to` in the DB. */
function rewriteReferences(from: string, to: string): number {
  const db = getSqlite();
  const pairs: [string, string][] = [[from, to]];
  if (encodeURIComponent(from) !== from) pairs.push([encodeURIComponent(from), encodeURIComponent(to)]);
  let rows = 0;
  withTransaction(() => {
    for (const [a, b] of pairs) {
      const hits = db
        .prepare("SELECT path, data FROM documents WHERE instr(data, ?) > 0")
        .all(a) as { path: string; data: string }[];
      const update = db.prepare("UPDATE documents SET data = ? WHERE path = ?");
      for (const row of hits) {
        update.run(row.data.split(a).join(b), row.path);
        rows += 1;
      }
    }
    db.prepare(
      `UPDATE files SET stored_name = replace(stored_name, ?, ?),
         relative_path = replace(relative_path, ?, ?),
         mime_type = CASE WHEN instr(relative_path, ?) > 0 THEN 'image/png' ELSE mime_type END
       WHERE instr(relative_path, ?) > 0`,
    ).run(from, to, from, to, from, from);
  });
  return rows;
}

/**
 * Convert referenced BMP uploads to lossless PNG. The PNG is written and the
 * documents updated before the BMP is deleted; a BMP that cannot be decoded,
 * or would not get smaller, is left untouched.
 */
function convertBmpUploads(paths: AppPaths, skipDirs: Set<string>): {
  converted: number;
  bytes: number;
  removed: string[];
} {
  const result = { converted: 0, bytes: 0, removed: [] as string[] };
  const bmps = [...listFiles(paths.floorPlans, skipDirs), ...listFiles(paths.uploads, skipDirs)].filter(
    (file) => /\.bmp$/i.test(file),
  );

  for (const bmpPath of bmps) {
    try {
      const bmp = fs.readFileSync(bmpPath);
      const png = bmpToPng(bmp);
      if (!png || png.length >= bmp.length) continue;

      const dir = path.dirname(bmpPath);
      const bmpName = path.basename(bmpPath);
      let pngName = bmpName.replace(/\.bmp$/i, ".png");
      if (fs.existsSync(path.join(dir, pngName))) {
        pngName = bmpName.replace(/\.bmp$/i, "_converted.png");
      }
      const pngPath = path.join(dir, pngName);
      fs.writeFileSync(pngPath, png);

      rewriteReferences(bmpName, pngName);
      fs.unlinkSync(bmpPath);
      result.converted += 1;
      result.bytes += bmp.length - png.length;
      result.removed.push(bmpPath);
    } catch (error) {
      serverLog(`[cleanup] Could not convert ${path.basename(bmpPath)}: ${(error as Error).message}`);
    }
  }
  return result;
}

export function runStartupStorageCleanup(paths: AppPaths): void {
  try {
    const freed = compactDbSnapshotBackups(paths.root);
    if (freed > 0) serverLog(`[cleanup] Backups: kept latest only, freed ${formatBytes(freed)}`);
  } catch (error) {
    serverLog(`[cleanup] Backup compaction skipped: ${(error as Error).message}`);
  }

  try {
    const freed = compactDatabase(paths.sqliteFile);
    if (freed > 0) serverLog(`[cleanup] Database compacted, freed ${formatBytes(freed)}`);
  } catch (error) {
    serverLog(`[cleanup] Database compaction skipped: ${(error as Error).message}`);
  }

  try {
    const text = collectReferenceText(paths);
    if (text.length < MIN_REFERENCE_TEXT) return;
    // Custom alert sounds may be referenced outside the DB — leave them alone.
    const skipDirs = new Set([path.resolve(paths.audio)]);
    const floorPlans = removeOrphanFiles(paths.floorPlans, text, skipDirs);
    const uploads = removeOrphanFiles(paths.uploads, text, skipDirs);
    const files = floorPlans.files + uploads.files;
    recordRemovedFiles(paths.root, [...floorPlans.removed, ...uploads.removed]);
    if (files > 0) {
      serverLog(
        `[cleanup] Removed ${files} unused uploaded file(s), freed ${formatBytes(floorPlans.bytes + uploads.bytes)}`,
      );
    }

    const bmp = convertBmpUploads(paths, skipDirs);
    recordRemovedFiles(paths.root, bmp.removed);
    if (bmp.converted > 0) {
      // Documents were edited with SQL — refresh caches/clients and the backup.
      invalidateDocumentsAfterDirectWrite();
      saveDbSnapshotBackup(readDb(), paths.root);
      serverLog(
        `[cleanup] Converted ${bmp.converted} BMP floor plan(s) to PNG, freed ${formatBytes(bmp.bytes)}`,
      );
    }
  } catch (error) {
    serverLog(`[cleanup] Unused file cleanup skipped: ${(error as Error).message}`);
  }
}
