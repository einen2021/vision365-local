import fs from "fs";
import path from "path";
import archiver from "archiver";
import extract from "extract-zip";
import { type AppPaths, safePath } from "./storageService";
import { getSqliteFilePath } from "../db/client";

export interface BackupInfo {
  filename: string;
  path: string;
  size: number;
  createdAt: string;
}

/** Create a ZIP backup of SQLite DB, uploads, and settings */
export async function createBackup(paths: AppPaths): Promise<BackupInfo> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `backup_${timestamp}.zip`;
  const backupPath = safePath(paths.backups, filename);

  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(backupPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", () => resolve());
    archive.on("error", reject);

    archive.pipe(output);

    const sqlitePath = getSqliteFilePath() || paths.sqliteFile;
    if (sqlitePath && fs.existsSync(sqlitePath)) {
      archive.file(sqlitePath, { name: "database/vision365.db" });
      // Include WAL/SHM if present so restore is consistent.
      for (const suffix of ["-wal", "-shm"]) {
        const side = `${sqlitePath}${suffix}`;
        if (fs.existsSync(side)) {
          archive.file(side, { name: `database/vision365.db${suffix}` });
        }
      }
    }
    if (fs.existsSync(paths.settingsFile)) {
      archive.file(paths.settingsFile, { name: "settings/settings.json" });
    }
    if (fs.existsSync(paths.uploads)) {
      archive.directory(paths.uploads, "uploads");
    }
    if (fs.existsSync(paths.floorPlans)) {
      archive.directory(paths.floorPlans, "floor-plans");
    }

    archive.finalize();
  });

  const stat = fs.statSync(backupPath);
  return {
    filename,
    path: backupPath,
    size: stat.size,
    createdAt: new Date().toISOString(),
  };
}

/** Restore from a backup ZIP */
export async function restoreBackup(
  paths: AppPaths,
  backupFilePath: string,
): Promise<{ success: boolean; message: string }> {
  const resolved = safePath(paths.backups, path.basename(backupFilePath));

  if (!fs.existsSync(resolved)) {
    return { success: false, message: "Backup file not found" };
  }

  const tempDir = safePath(paths.temp, `restore_${Date.now()}`);
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    await extract(resolved, { dir: tempDir });

    const sqliteSource = path.join(tempDir, "database", "vision365.db");
    const legacyMongo = path.join(tempDir, "mongodb");

    if (fs.existsSync(sqliteSource)) {
      fs.mkdirSync(paths.database, { recursive: true });
      fs.copyFileSync(sqliteSource, paths.sqliteFile);
      for (const suffix of ["-wal", "-shm"]) {
        const side = `${sqliteSource}${suffix}`;
        const dest = `${paths.sqliteFile}${suffix}`;
        if (fs.existsSync(side)) {
          fs.copyFileSync(side, dest);
        } else if (fs.existsSync(dest)) {
          fs.unlinkSync(dest);
        }
      }
    } else if (fs.existsSync(legacyMongo)) {
      // Old Mongo ZIP backups cannot be loaded into SQLite directly.
      // Tell the user to use JSON snapshot restore instead.
      return {
        success: false,
        message:
          "This backup contains MongoDB files. Use Settings → Restore DB Snapshot " +
          "(JSON under backups/db-snapshots) or place db_snapshot_latest.json and restart.",
      };
    }

    const settingsSource = path.join(tempDir, "settings", "settings.json");
    if (fs.existsSync(settingsSource)) {
      fs.copyFileSync(settingsSource, paths.settingsFile);
    }

    const uploadsSource = path.join(tempDir, "uploads");
    if (fs.existsSync(uploadsSource)) {
      copyDirRecursive(uploadsSource, paths.uploads);
    }

    const floorPlansSource = path.join(tempDir, "floor-plans");
    if (fs.existsSync(floorPlansSource)) {
      copyDirRecursive(floorPlansSource, paths.floorPlans);
    }

    return {
      success: true,
      message: "Backup restored successfully. Please restart the application.",
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function copyDirRecursive(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/** List available backups */
export function listBackups(paths: AppPaths): BackupInfo[] {
  if (!fs.existsSync(paths.backups)) return [];

  return fs
    .readdirSync(paths.backups)
    .filter((f) => f.endsWith(".zip"))
    .map((filename) => {
      const fullPath = path.join(paths.backups, filename);
      const stat = fs.statSync(fullPath);
      return {
        filename,
        path: fullPath,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
