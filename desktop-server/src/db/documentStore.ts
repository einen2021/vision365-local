/**
 * Document store backed by SQLite `documents` table.
 * Each top-level key is its own row (path + JSON data).
 * Keeps the same read/mutate/write API used by /api/db routes.
 */

import { getSqlite, withTransaction } from "./client";
import {
  countProductiveData,
  queueDbSnapshotBackup,
  saveDbSnapshotBackup,
} from "../services/dbSnapshotBackup";

export type DbRecord = Record<string, unknown>;

/** In-memory cache so repeated reads during one request stay fast. */
let cache: DbRecord | null = null;
let cacheRevision = -1;

let dbLock: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T> | T): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const prev = dbLock;
  dbLock = gate;
  await prev;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Call after rows in `documents` were changed with direct SQL (startup
 * storage cleanup): drops the in-memory cache and makes every client refetch.
 */
export function invalidateDocumentsAfterDirectWrite(): void {
  const revision = bumpRevision();
  cache = null;
  cacheRevision = -1;
  resetChangeTracking(revision);
}

/** Current change revision (for realtime polling). */
export function getDbRevision(): number {
  const row = getSqlite()
    .prepare("SELECT value FROM meta WHERE key = ?")
    .get("revision") as { value: string } | undefined;
  return Number(row?.value || 0);
}

function bumpRevision(): number {
  const db = getSqlite();
  const next = getDbRevision() + 1;
  db.prepare(
    "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run("revision", String(next));
  return next;
}

/** Load all document rows into one object (same shape the API already expects). */
export function readDb(): DbRecord {
  const rev = getDbRevision();
  if (cache && cacheRevision === rev) {
    // Return a shallow copy so callers can mutate safely inside withDb.
    return { ...cache };
  }

  const rows = getSqlite()
    .prepare("SELECT path, data FROM documents")
    .all() as { path: string; data: string }[];

  const result: DbRecord = {};
  for (const row of rows) {
    try {
      result[row.path] = JSON.parse(row.data);
    } catch {
      result[row.path] = {};
    }
  }

  cache = result;
  cacheRevision = rev;
  return { ...result };
}

/**
 * Replace document rows from a full snapshot object.
 * Each Object.keys(data) becomes one SQLite row.
 */
export function writeDb(data: DbRecord): void {
  const existing = readDb();
  const nextScore = countProductiveData(data).score;
  const prevScore = countProductiveData(existing).score;

  // Never replace a full database with an empty seed-shaped payload.
  if (prevScore > 0 && nextScore === 0) {
    console.error(
      "[db] Refusing to overwrite productive database with empty snapshot " +
        `(had communities/assets/building data score=${prevScore})`,
    );
    try {
      saveDbSnapshotBackup(existing);
    } catch (error) {
      console.warn("[db] backup before refused wipe failed:", (error as Error).message);
    }
    return;
  }

  const now = new Date().toISOString();
  const nextKeys = new Set(Object.keys(data));

  withTransaction(() => {
    const db = getSqlite();
    const upsert = db.prepare(
      `INSERT INTO documents (path, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    );
    const del = db.prepare("DELETE FROM documents WHERE path = ?");

    // Update / insert every top-level key.
    for (const key of nextKeys) {
      upsert.run(key, JSON.stringify(data[key] ?? null), now);
    }

    // Remove keys that no longer exist.
    for (const key of Object.keys(existing)) {
      if (!nextKeys.has(key)) {
        del.run(key);
      }
    }

    bumpRevision();
  });

  cache = { ...data };
  cacheRevision = getDbRevision();
  resetChangeTracking(cacheRevision);

  if (nextScore > 0) {
    queueDbSnapshotBackup(data);
  }
}

/** True when the documents table has no rows yet. */
export function isDocumentsEmpty(): boolean {
  const row = getSqlite()
    .prepare("SELECT COUNT(*) AS count FROM documents")
    .get() as { count: number };
  return !row || row.count === 0;
}

function resolveCollection(db: DbRecord, segments: string[]): DbRecord | null {
  if (!segments || segments.length === 0) return null;

  let nested: unknown = db;
  let nestedOk = true;
  for (const key of segments) {
    if (nested == null || typeof nested !== "object" || (nested as DbRecord)[key] === undefined) {
      nestedOk = false;
      break;
    }
    nested = (nested as DbRecord)[key];
  }
  if (nestedOk && nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as DbRecord;
  }

  const joined = segments.join("/");
  const flat = db[joined];
  if (flat && typeof flat === "object" && !Array.isArray(flat)) {
    return flat as DbRecord;
  }

  if (segments.length > 1) {
    const head = segments[0];
    const tail = segments.slice(1).join("/");
    const partial = (db[head] as DbRecord)?.[tail];
    if (partial && typeof partial === "object" && !Array.isArray(partial)) {
      return partial as DbRecord;
    }
  }

  return null;
}

function ensureCollection(db: DbRecord, segments: string[]): DbRecord {
  const existing = resolveCollection(db, segments);
  if (existing) return existing;

  if (segments.length === 3 && segments[1] === "asset") {
    const key = `${segments[0]}/asset/${segments[2]}`;
    if (!db[key] || typeof db[key] !== "object") {
      db[key] = {};
    }
    return db[key] as DbRecord;
  }

  let current: DbRecord = db;
  for (const key of segments) {
    if (current[key] === undefined || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as DbRecord;
  }
  return current;
}

function getParent(db: DbRecord, segments: string[]) {
  if (segments.length === 1) {
    return { parent: db, lastKey: segments[0] };
  }
  const docId = segments[segments.length - 1];
  const collection = ensureCollection(db, segments.slice(0, -1));
  return { parent: collection, lastKey: docId };
}

export function getDocument(db: DbRecord, segments: string[]): unknown {
  if (!segments || segments.length === 0) return null;

  if (segments.length === 1) {
    return db[segments[0]] ?? null;
  }

  const docId = segments[segments.length - 1];
  const collection = resolveCollection(db, segments.slice(0, -1));
  if (collection && collection[docId] !== undefined) {
    return collection[docId];
  }
  return null;
}

export function setDocument(
  db: DbRecord,
  segments: string[],
  data: unknown,
  merge = false,
): void {
  const { parent, lastKey } = getParent(db, segments);
  if (merge) {
    const existing =
      parent[lastKey] && typeof parent[lastKey] === "object" && !Array.isArray(parent[lastKey])
        ? { ...(parent[lastKey] as DbRecord) }
        : {};
    applyUpdate(existing, (data || {}) as DbRecord);
    parent[lastKey] = existing;
  } else {
    parent[lastKey] = data;
  }
}

export function deleteDocument(db: DbRecord, segments: string[]): void {
  const collection =
    segments.length > 1 ? resolveCollection(db, segments.slice(0, -1)) : db;
  if (collection) {
    delete collection[segments[segments.length - 1]];
  }
}

export function listCollection(db: DbRecord, segments: string[]) {
  const current = resolveCollection(db, segments);
  if (!current || typeof current !== "object" || Array.isArray(current)) return [];

  return Object.entries(current).map(([id, data]) => ({
    id,
    data: typeof data === "object" && data !== null ? data : { value: data },
  }));
}

export function applyConstraints(
  docs: { id: string; data: DbRecord }[],
  constraints: {
    type: string;
    field?: string;
    op?: string;
    value?: unknown;
    direction?: string;
    count?: number;
  }[] = [],
) {
  let result = [...docs];

  for (const c of constraints) {
    if (c.type === "where" && c.field) {
      result = result.filter((doc) => {
        const val = doc.data[c.field!];
        if (c.op === "==") return val === c.value;
        if (c.op === "!=") return val !== c.value;
        return true;
      });
    }
    if (c.type === "orderBy" && c.field) {
      result.sort((a, b) => {
        const av = a.data[c.field!];
        const bv = b.data[c.field!];
        if (av === bv) return 0;
        const cmp = (av as string | number) > (bv as string | number) ? 1 : -1;
        return c.direction === "desc" ? -cmp : cmp;
      });
    }
    if (c.type === "limit" && c.count) {
      result = result.slice(0, c.count);
    }
  }

  return result;
}

export function applyUpdate(target: DbRecord, updates: DbRecord): void {
  for (const [key, value] of Object.entries(updates)) {
    if (value && typeof value === "object" && (value as DbRecord).__arrayUnion) {
      const existing = Array.isArray(target[key]) ? (target[key] as unknown[]) : [];
      const merged = [...existing];
      for (const item of (value as { __arrayUnion: unknown[] }).__arrayUnion) {
        if (!merged.some((e) => JSON.stringify(e) === JSON.stringify(item))) {
          merged.push(item);
        }
      }
      target[key] = merged;
    } else if (value && typeof value === "object" && (value as DbRecord).__deleteField) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}

export function generateId(): string {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ---------------------------------------------------------------------------
// Per-path change tracking (in memory). Lets realtime listeners refetch only
// when their own document / collection changed, and lets collection listeners
// pull just the changed documents instead of the whole collection (AssetsList
// is several MB). Reset by any full-database write and on server restart.
// ---------------------------------------------------------------------------

/** Anything at or below this revision is unknown — listeners must refetch fully. */
let baselineRevision = -1;
/** path → last revision of a write at or below it. */
const subtreeRevision = new Map<string, number>();
/** path → last revision of a write exactly at it (replaces everything below). */
const directRevision = new Map<string, number>();
/** collection path → doc id → last revision that changed that doc. */
const docRevisions = new Map<string, Map<string, number>>();

function pathKey(segments: string[]): string {
  return segments.join("/");
}

function ensureBaseline() {
  if (baselineRevision < 0) baselineRevision = getDbRevision();
}

function resetChangeTracking(revision: number) {
  baselineRevision = revision;
  subtreeRevision.clear();
  directRevision.clear();
  docRevisions.clear();
}

function recordPathWrites(paths: string[][], revision: number) {
  ensureBaseline();
  for (const segments of paths) {
    if (!Array.isArray(segments) || segments.length === 0) continue;
    directRevision.set(pathKey(segments), revision);
    for (let k = 1; k <= segments.length; k++) {
      subtreeRevision.set(pathKey(segments.slice(0, k)), revision);
    }
    // Every document on the way down changed inside its parent collection.
    for (let k = 2; k <= segments.length; k++) {
      const collectionKey = pathKey(segments.slice(0, k - 1));
      let docs = docRevisions.get(collectionKey);
      if (!docs) {
        docs = new Map();
        docRevisions.set(collectionKey, docs);
      }
      docs.set(segments[k - 1], revision);
    }
  }
}

/** Revision of the data at `segments`: changes when it, anything below it, or a parent is written. */
export function getPathRevision(segments: string[]): number {
  ensureBaseline();
  let revision = Math.max(baselineRevision, subtreeRevision.get(pathKey(segments)) ?? -1);
  for (let k = 1; k < segments.length; k++) {
    revision = Math.max(revision, directRevision.get(pathKey(segments.slice(0, k))) ?? -1);
  }
  return revision;
}

/**
 * Documents of a collection changed since `since`. Returns null when a full
 * refetch is required (tracking reset, or the collection itself / a parent was
 * replaced wholesale).
 */
export function getCollectionChanges(
  db: DbRecord,
  segments: string[],
  since: number,
): { revision: number; docs: { id: string; data: unknown }[]; deleted: string[] } | null {
  ensureBaseline();
  if (since < baselineRevision) return null;
  for (let k = 1; k <= segments.length; k++) {
    if ((directRevision.get(pathKey(segments.slice(0, k))) ?? -1) > since) return null;
  }

  const docs: { id: string; data: unknown }[] = [];
  const deleted: string[] = [];
  const changed = docRevisions.get(pathKey(segments));
  if (changed) {
    for (const [id, revision] of changed) {
      if (revision <= since) continue;
      const data = getDocument(db, [...segments, id]);
      if (data === null || data === undefined) deleted.push(id);
      else docs.push({ id, data: typeof data === "object" ? data : { value: data } });
    }
  }
  return { revision: getPathRevision(segments), docs, deleted };
}

/** Transactional read-modify-write */
export async function withDb<T>(fn: (db: DbRecord) => T | Promise<T>): Promise<T> {
  return withLock(async () => {
    const snapshot = readDb();
    const result = await fn(snapshot);
    writeDb(snapshot);
    return result;
  });
}

/** Top-level row keys a document path can live under (nested `a` or flat `a/b/...`). */
function rowKeysForPath(segments: string[]): string[] {
  const keys: string[] = [];
  for (let k = 1; k <= segments.length; k++) {
    keys.push(segments.slice(0, k).join("/"));
  }
  return keys;
}

/**
 * Persist only the rows touched by `paths` (plus any top-level keys added or
 * removed). Avoids re-serializing and upserting every collection on each write.
 */
function writeDbRows(
  snapshot: DbRecord,
  paths: string[][],
  keysBefore: Set<string>,
): void {
  const dirty = new Set<string>();
  for (const segments of paths) {
    for (const key of rowKeysForPath(segments)) {
      if (key in snapshot) dirty.add(key);
    }
  }
  const removed: string[] = [];
  for (const key of keysBefore) {
    if (!(key in snapshot)) removed.push(key);
  }
  for (const key of Object.keys(snapshot)) {
    if (!keysBefore.has(key)) dirty.add(key);
  }
  if (dirty.size === 0 && removed.length === 0) return;

  const now = new Date().toISOString();
  withTransaction(() => {
    const db = getSqlite();
    const upsert = db.prepare(
      `INSERT INTO documents (path, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    );
    const del = db.prepare("DELETE FROM documents WHERE path = ?");
    for (const key of dirty) {
      upsert.run(key, JSON.stringify(snapshot[key] ?? null), now);
    }
    for (const key of removed) {
      del.run(key);
    }
    bumpRevision();
  });

  cache = { ...snapshot };
  cacheRevision = getDbRevision();
  recordPathWrites(paths, cacheRevision);
  queueDbSnapshotBackup(snapshot);
}

/**
 * Read-modify-write for document-path operations (/api/db set/update/delete/add/batch).
 * Only the rows under `paths` are written back.
 */
export async function withDbPaths<T>(
  paths: string[][],
  fn: (db: DbRecord) => T | Promise<T>,
): Promise<T> {
  return withLock(async () => {
    const snapshot = readDb();
    const keysBefore = new Set(Object.keys(snapshot));
    const result = await fn(snapshot);
    writeDbRows(snapshot, paths, keysBefore);
    return result;
  });
}

/**
 * Read-modify-write that only persists when markDirty() was called.
 * markDirty(path) writes just that document's rows; markDirty() with no path
 * (callers that change many collections at once) rewrites the whole database.
 */
export async function withDbMutate<T>(
  fn: (db: DbRecord, ctx: { markDirty: (path?: string[]) => void }) => T | Promise<T>,
): Promise<T> {
  return withLock(async () => {
    const snapshot = readDb();
    const keysBefore = new Set(Object.keys(snapshot));
    let dirty = false;
    let fullWrite = false;
    const paths: string[][] = [];
    const result = await fn(snapshot, {
      markDirty: (path?: string[]) => {
        dirty = true;
        if (path?.length) paths.push(path);
        else fullWrite = true;
      },
    });
    if (fullWrite) writeDb(snapshot);
    else if (dirty) writeDbRows(snapshot, paths, keysBefore);
    return result;
  });
}
