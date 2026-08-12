/**
 * SQLite helpers for users / sessions / files / settings tables.
 */

import { getSqlite } from "./client";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  role: string;
  designation: string;
  created_at: string;
  updated_at: string;
}

export interface SessionRow {
  id: string;
  user_id: string;
  token: string;
  expires_at: string;
  created_at: string;
}

export interface FileRow {
  id: string;
  category: string | null;
  original_name: string | null;
  stored_name: string | null;
  relative_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  checksum: string | null;
  created_at: string;
}

export function findUserByEmail(email: string): UserRow | null {
  const row = getSqlite()
    .prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE")
    .get(email.trim()) as UserRow | undefined;
  return row || null;
}

export function findUserById(id: string): UserRow | null {
  const row = getSqlite()
    .prepare("SELECT * FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  return row || null;
}

export function upsertUser(user: UserRow): void {
  getSqlite()
    .prepare(
      `INSERT INTO users (id, email, password_hash, role, designation, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         email = excluded.email,
         password_hash = excluded.password_hash,
         role = excluded.role,
         designation = excluded.designation,
         updated_at = excluded.updated_at`,
    )
    .run(
      user.id,
      user.email,
      user.password_hash,
      user.role,
      user.designation,
      user.created_at,
      user.updated_at,
    );
}

export function updateUserPassword(userId: string, passwordHash: string): void {
  getSqlite()
    .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .run(passwordHash, new Date().toISOString(), userId);
}

export function insertSession(session: SessionRow): void {
  getSqlite()
    .prepare(
      `INSERT INTO sessions (id, user_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      session.id,
      session.user_id,
      session.token,
      session.expires_at,
      session.created_at,
    );
}

export function findValidSession(token: string): SessionRow | null {
  const now = new Date().toISOString();
  const row = getSqlite()
    .prepare("SELECT * FROM sessions WHERE token = ? AND expires_at > ?")
    .get(token, now) as SessionRow | undefined;
  return row || null;
}

export function deleteSessionByToken(token: string): void {
  getSqlite().prepare("DELETE FROM sessions WHERE token = ?").run(token);
}

export function insertFile(file: FileRow): void {
  getSqlite()
    .prepare(
      `INSERT INTO files (
         id, category, original_name, stored_name, relative_path,
         mime_type, size_bytes, checksum, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      file.id,
      file.category,
      file.original_name,
      file.stored_name,
      file.relative_path,
      file.mime_type,
      file.size_bytes,
      file.checksum,
      file.created_at,
    );
}

export function deleteFileByRelativePath(relativePath: string): void {
  getSqlite()
    .prepare("DELETE FROM files WHERE relative_path = ?")
    .run(relativePath);
}

export function findFileById(id: string): FileRow | null {
  const row = getSqlite()
    .prepare("SELECT * FROM files WHERE id = ?")
    .get(id) as FileRow | undefined;
  return row || null;
}

export function upsertSetting(key: string, value: string): void {
  const now = new Date().toISOString();
  getSqlite()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, value, now);
}
