/**
 * Firestore-compatible document store backed by MongoDB db_snapshot collection.
 * Logic mirrors src/lib/serverDb.js for zero functionality loss.
 */

import { getCollection } from "./client";
import {
  countProductiveData,
  queueDbSnapshotBackup,
  saveDbSnapshotBackup,
} from "../services/dbSnapshotBackup";

type DbRecord = Record<string, unknown>;

const SNAPSHOT_ID = 1;
const COLLECTION = "db_snapshot";

let dbLock: Promise<void> = Promise.resolve();

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
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

export async function readDb(): Promise<DbRecord> {
  const collection = getCollection(COLLECTION);
  const doc = await collection.findOne({ _id: SNAPSHOT_ID });
  if (!doc?.data || typeof doc.data !== "object") return {};
  return doc.data as DbRecord;
}

export async function writeDb(data: DbRecord): Promise<void> {
  const collection = getCollection(COLLECTION);
  const existing = await collection.findOne({ _id: SNAPSHOT_ID });
  const existingData =
    existing?.data && typeof existing.data === "object"
      ? (existing.data as DbRecord)
      : {};

  const nextScore = countProductiveData(data).score;
  const prevScore = countProductiveData(existingData).score;

  // Never replace a full database with an empty seed-shaped payload.
  if (prevScore > 0 && nextScore === 0) {
    console.error(
      "[db] Refusing to overwrite productive database with empty snapshot " +
        `(had communities/assets/building data score=${prevScore})`,
    );
    // Keep a backup of what we still have before abandoning the wipe.
    try {
      saveDbSnapshotBackup(existingData);
    } catch (error) {
      console.warn("[db] backup before refused wipe failed:", (error as Error).message);
    }
    return;
  }

  const now = new Date().toISOString();
  await collection.updateOne(
    { _id: SNAPSHOT_ID },
    { $set: { data, updated_at: now } },
    { upsert: true },
  );

  // Auto-backup off the request path (throttled) — do not block writes.
  if (nextScore > 0) {
    queueDbSnapshotBackup(data);
  }
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
  merge = false
): void {
  const { parent, lastKey } = getParent(db, segments);
  if (merge) {
    // Merge must honor deleteField() / __deleteField markers (not shallow-spread them in).
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
  constraints: { type: string; field?: string; op?: string; value?: unknown; direction?: string; count?: number }[] = []
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

/** Transactional read-modify-write */
export async function withDb<T>(fn: (db: DbRecord) => T | Promise<T>): Promise<T> {
  return withLock(async () => {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  });
}

/** Read-modify-write that only persists when markDirty() was called */
export async function withDbMutate<T>(
  fn: (
    db: DbRecord,
    ctx: { markDirty: () => void }
  ) => T | Promise<T>
): Promise<T> {
  return withLock(async () => {
    const db = await readDb();
    let dirty = false;
    const result = await fn(db, {
      markDirty: () => {
        dirty = true;
      },
    });
    if (dirty) await writeDb(db);
    return result;
  });
}
