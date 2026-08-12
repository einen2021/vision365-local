/**
 * Create SQLite tables and indexes.
 * Safe to run on every startup (CREATE IF NOT EXISTS).
 */

import { getSqlite } from "./client";

export function runMigrations(): void {
  const db = getSqlite();

  // App data: one row per top-level key (UserDB, AssetsList, BuildingDB, …)
  // This is real SQLite rows — NOT a Mongo blob and NOT Firebase.
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      path TEXT PRIMARY KEY NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY NOT NULL,
      email TEXT NOT NULL COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      designation TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY NOT NULL,
      category TEXT,
      original_name TEXT,
      stored_name TEXT,
      relative_path TEXT,
      mime_type TEXT,
      size_bytes INTEGER,
      checksum TEXT,
      created_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_category ON files(category);
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_files_relative_path ON files(relative_path);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Realtime: bump revision on every documents write so clients can poll cheaply.
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  const existing = db.prepare("SELECT value FROM meta WHERE key = ?").get("revision") as
    | { value: string }
    | undefined;
  if (!existing) {
    db.prepare("INSERT INTO meta (key, value) VALUES (?, ?)").run("revision", "0");
  }

  console.log("[migrate] SQLite schema ready");
}
