/**
 * SQLite database client (Node built-in node:sqlite).
 * Replaces the old MongoDB connection.
 */

import fs from "fs";
import path from "path";
import { DatabaseSync } from "node:sqlite";

const DB_FILE_NAME = "vision365.db";

let db: DatabaseSync | null = null;
let dbFilePath: string | null = null;

/** Full path to the SQLite file under AppData/database/ */
export function getSqlitePath(databaseDir: string): string {
  return path.join(databaseDir, DB_FILE_NAME);
}

/**
 * Open (or create) the SQLite database with WAL for fast concurrent reads.
 * Call this once during server startup.
 */
export function connectSqlite(databaseDir: string): DatabaseSync {
  if (db) return db;

  fs.mkdirSync(databaseDir, { recursive: true });
  const filePath = getSqlitePath(databaseDir);

  // Older installs accidentally used vision365.db as a folder name.
  // SQLite needs a file — quarantine the folder so we can create the DB.
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const quarantine = path.join(databaseDir, `vision365.db-dir-quarantine-${stamp}`);
    fs.renameSync(filePath, quarantine);
    console.warn(
      `[sqlite] Found directory at ${filePath} — moved to ${quarantine}`,
    );
  }

  dbFilePath = filePath;

  // Open the file — creates it if missing.
  db = new DatabaseSync(filePath);

  // WAL = writers don't block readers; good for desktop realtime reads.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA temp_store = MEMORY");
  db.exec("PRAGMA foreign_keys = ON");

  return db;
}

/** Get the open database (throws if connectSqlite was not called). */
export function getSqlite(): DatabaseSync {
  if (!db) {
    throw new Error("SQLite not connected. Call connectSqlite() first.");
  }
  return db;
}

export function getSqliteFilePath(): string | null {
  return dbFilePath;
}

/** Close the database cleanly (flush WAL). */
export function closeDatabase(): void {
  if (db) {
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    } catch {
      // ignore checkpoint errors on shutdown
    }
    db.close();
    db = null;
    dbFilePath = null;
  }
}

/** Run a function inside a SQLite transaction (all-or-nothing). */
export function withTransaction<T>(fn: () => T): T {
  const database = getSqlite();
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      database.exec("ROLLBACK");
    } catch {
      // ignore
    }
    throw error;
  }
}
