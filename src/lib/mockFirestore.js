/**
 * Client-side Firestore mock — same API shape as firebase/firestore.
 * All data is stored locally via /api/db (web or desktop).
 */

import { apiFetch } from "./apiClient";

const queryConstraints = new WeakMap();

class CollectionReference {
  constructor(path) {
    this._path = path;
    this.type = "collection";
  }
}

class DocumentReference {
  constructor(path) {
    this._path = path;
    this.type = "document";
  }
  get id() {
    return this._path[this._path.length - 1];
  }
}

class DocumentSnapshot {
  constructor(id, data, exists, path) {
    this.id = id;
    this._data = data;
    this._exists = exists;
    this._refPath = path;
  }
  get ref() {
    return this._refPath ? new DocumentReference(this._refPath) : undefined;
  }
  exists() {
    return this._exists;
  }
  data() {
    return this._data;
  }
}

class QuerySnapshot {
  constructor(docs) {
    this.docs = docs;
    this.empty = docs.length === 0;
    this.size = docs.length;
  }
  forEach(callback) {
    this.docs.forEach(callback);
  }
}

class Query {
  constructor(collectionRef, constraints) {
    this._collection = collectionRef;
    this._constraints = constraints;
    this.type = "query";
  }
}

async function apiCall(body) {
  const res = await apiFetch("/api/db", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Database request failed");
  }
  return res.json();
}

function getPath(ref) {
  if (ref._collection) return ref._collection._path;
  return ref._path;
}

export function collection(db, ...pathSegments) {
  return new CollectionReference(pathSegments);
}

export function doc(dbOrCol, ...pathSegments) {
  if (dbOrCol instanceof CollectionReference) {
    return new DocumentReference([...dbOrCol._path, pathSegments[0]]);
  }
  return new DocumentReference(pathSegments);
}

export function query(collectionRef, ...constraints) {
  return new Query(collectionRef, constraints);
}

export function where(field, op, value) {
  return { type: "where", field, op, value };
}

export function orderBy(field, direction = "asc") {
  return { type: "orderBy", field, direction };
}

export function limit(count) {
  return { type: "limit", count };
}

export function arrayUnion(...values) {
  return { __arrayUnion: values };
}

export function deleteField() {
  return { __deleteField: true };
}

/** Firestore Timestamp mock — stored as ISO string in JSON */
export class Timestamp {
  constructor(seconds, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toDate() {
    return new Date(this.seconds * 1000 + this.nanoseconds / 1e6);
  }

  toMillis() {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }

  static now() {
    const ms = Date.now();
    return Timestamp.fromMillis(ms);
  }

  static fromDate(date) {
    const ms = date instanceof Date ? date.getTime() : new Date(date).getTime();
    return Timestamp.fromMillis(ms);
  }

  static fromMillis(ms) {
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
}

export function serverTimestamp() {
  return new Date().toISOString();
}

export async function getDocs(refOrQuery) {
  let path;
  let constraints = [];

  if (refOrQuery instanceof Query) {
    path = refOrQuery._collection._path;
    constraints = refOrQuery._constraints;
  } else {
    path = refOrQuery._path;
  }

  const result = await apiCall({ op: "list", path, constraints });
  const docs = (result.docs || []).map(
    (d) => new DocumentSnapshot(d.id, d.data, true, [...path, d.id]),
  );
  return new QuerySnapshot(docs);
}

export async function getDoc(docRef) {
  const result = await apiCall({ op: "get", path: docRef._path });
  return new DocumentSnapshot(
    docRef.id,
    result.data,
    result.exists,
    docRef._path,
  );
}

export async function setDoc(docRef, data, options = {}) {
  await apiCall({
    op: "set",
    path: docRef._path,
    data,
    merge: options.merge === true,
  });
}

export async function updateDoc(docRef, data) {
  await apiCall({ op: "update", path: docRef._path, data });
}

export async function deleteDoc(docRef) {
  await apiCall({ op: "delete", path: docRef._path });
}

export async function addDoc(collectionRef, data) {
  const result = await apiCall({
    op: "add",
    path: collectionRef._path,
    data: {
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: data.updatedAt || new Date().toISOString(),
    },
  });
  return new DocumentReference([...collectionRef._path, result.id]);
}

/** Add many documents in one request — avoids concurrent write races */
export async function addDocsBatch(collectionRef, items) {
  if (!items.length) return 0;

  const now = new Date().toISOString();
  const operations = items.map((data, index) => {
    const id = `doc_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 9)}`;
    return {
      type: "set",
      path: [...collectionRef._path, id],
      data: {
        ...data,
        createdAt: data.createdAt || now,
        updatedAt: data.updatedAt || now,
      },
      options: {},
    };
  });

  await apiCall({ op: "batch", operations });
  return items.length;
}

/** Set many documents with explicit IDs in one request.
 * Pass `merge: true` on an item to update fields without wiping the rest of the doc.
 */
export async function setDocsBatch(collectionRef, items) {
  if (!items.length) return 0;

  const now = new Date().toISOString();
  const operations = items.map(({ id, data, merge }) => {
    const useMerge = merge === true;
    return {
      type: "set",
      path: [...collectionRef._path, String(id)],
      data: {
        ...data,
        // Keep createdAt on full creates; leave it alone on merge updates.
        ...(useMerge ? {} : { createdAt: data.createdAt || now }),
        updatedAt: data.updatedAt || now,
      },
      options: useMerge ? { merge: true } : {},
    };
  });

  await apiCall({ op: "batch", operations });
  return items.length;
}

/** Delete many documents in batched requests (500 ops per batch). */
export async function deleteDocsBatch(docRefs) {
  if (!docRefs.length) return 0;

  const BATCH_SIZE = 500;
  let deleted = 0;

  for (let i = 0; i < docRefs.length; i += BATCH_SIZE) {
    const chunk = docRefs.slice(i, i + BATCH_SIZE);
    const operations = chunk.map((docRef) => ({
      type: "delete",
      path: docRef._path,
    }));
    await apiCall({ op: "batch", operations });
    deleted += chunk.length;
  }

  return deleted;
}

/**
 * Append rows to array fields on the server (de-duplicated there against recent
 * entries) without downloading the existing arrays.
 * @param {{ ref: DocumentReference, field: string }[]} targets
 * @param {object[]} rows
 */
export async function appendRowsToDocs(targets, rows) {
  if (!targets?.length || !rows?.length) return { appended: 0 };
  try {
    return await apiCall({
      op: "appendRows",
      targets: targets.map((t) => ({ path: t.ref._path, field: t.field })),
      rows,
    });
  } catch (error) {
    if (!/unknown operation/i.test(error?.message || "")) throw error;
    // API server older than this client — append the old way (read + write back).
    for (const { ref, field } of targets) {
      const snap = await getDoc(ref);
      const existing = snap.exists() && Array.isArray(snap.data()?.[field]) ? snap.data()[field] : [];
      await setDoc(ref, { [field]: [...existing, ...rows] }, { merge: true });
    }
    return { appended: rows.length * targets.length };
  }
}

export function writeBatch(db) {
  const operations = [];
  return {
    set(ref, data, options) {
      operations.push({
        type: "set",
        path: ref._path,
        data,
        options: options || {},
      });
    },
    update(ref, data) {
      operations.push({ type: "update", path: ref._path, data });
    },
    delete(ref) {
      operations.push({ type: "delete", path: ref._path });
    },
    async commit() {
      await apiCall({ op: "batch", operations });
    },
  };
}

// ---------------------------------------------------------------------------
// Collection mirrors — one in-memory copy per collection path, kept current by
// asking the server only for documents changed since the last sync. AssetsList
// is several MB; this turns a full refetch into a few KB per change.
// Mirror data is shared: treat snapshots from getDocsMirrored() as read-only.
// ---------------------------------------------------------------------------

const collectionMirrors = new Map();
/** Set when the API server predates the "changes" op (restart it to re-enable). */
let changesOpUnsupported = false;

function syncCollectionMirror(path) {
  const key = JSON.stringify(path);
  let mirror = collectionMirrors.get(key);
  if (!mirror) {
    mirror = { path, docs: null, revision: -1, snapshot: null, inflight: null };
    collectionMirrors.set(key, mirror);
  }
  if (mirror.inflight) return mirror.inflight;

  mirror.inflight = (async () => {
    try {
      if (mirror.docs && !changesOpUnsupported) {
        // An API server older than this client answers "Unknown operation" —
        // fall back to full refetches (and stop asking) instead of failing.
        const res = await apiCall({ op: "changes", path, since: mirror.revision }).catch(
          (error) => {
            if (/unknown operation/i.test(error?.message || "")) changesOpUnsupported = true;
            return { full: true };
          },
        );
        if (!res.full) {
          if (res.docs.length > 0 || res.deleted.length > 0) {
            for (const d of res.docs) mirror.docs.set(d.id, d.data);
            for (const id of res.deleted) mirror.docs.delete(id);
            mirror.snapshot = null;
          }
          mirror.revision = res.revision;
          return mirror;
        }
      }
      const res = await apiCall({ op: "list", path, constraints: [] });
      mirror.docs = new Map((res.docs || []).map((d) => [d.id, d.data]));
      mirror.revision = typeof res.pathRevision === "number" ? res.pathRevision : -1;
      mirror.snapshot = null;
      return mirror;
    } finally {
      mirror.inflight = null;
    }
  })();
  return mirror.inflight;
}

/** Same QuerySnapshot object until the collection changes — callers can compare by identity. */
function mirrorSnapshot(mirror) {
  if (!mirror.snapshot) {
    const docs = [];
    for (const [id, data] of mirror.docs) {
      docs.push(new DocumentSnapshot(id, data, true, [...mirror.path, id]));
    }
    mirror.snapshot = new QuerySnapshot(docs);
  }
  return mirror.snapshot;
}

/**
 * getDocs for a whole collection, synced incrementally. Returns the identical
 * snapshot object when nothing changed. Data is shared — do not mutate it.
 */
export async function getDocsMirrored(collectionRef) {
  return mirrorSnapshot(await syncCollectionMirror(collectionRef._path));
}

/**
 * Realtime listener: poll the cheap path-scoped /api/db/revision (changes only
 * when this document / collection is written), then refetch. Whole-collection
 * listeners receive only the changed documents from the server.
 */
export function onSnapshot(ref, onNext, onError) {
  let active = true;
  let lastRevision = null;
  let lastJson = "";
  let lastSnapshot = null;
  const path = getPath(ref);
  const isWholeCollection = ref instanceof CollectionReference;
  const revisionUrl = `/api/db/revision?path=${encodeURIComponent(JSON.stringify(path))}`;

  async function fetchRevision() {
    try {
      const res = await apiFetch(revisionUrl);
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body.revision === "number" ? body.revision : null;
    } catch {
      return null;
    }
  }

  async function poll() {
    if (!active) return;
    try {
      const revision = await fetchRevision();
      // Skip heavy get/list when revision is unchanged.
      if (revision !== null && revision === lastRevision) {
        if (active) setTimeout(poll, 250);
        return;
      }

      if (isWholeCollection) {
        const snapshot = await getDocsMirrored(ref);
        if (revision !== null) lastRevision = revision;
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          onNext(snapshot);
        }
      } else {
        const snapshot =
          ref instanceof DocumentReference ? await getDoc(ref) : await getDocs(ref);
        const json = JSON.stringify(
          ref instanceof DocumentReference
            ? snapshot.data()
            : snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
        );
        if (revision !== null) lastRevision = revision;
        if (json !== lastJson) {
          lastJson = json;
          onNext(snapshot);
        }
      }
    } catch (err) {
      if (onError) onError(err);
    }
    if (active) setTimeout(poll, 250);
  }

  poll();

  return () => {
    active = false;
  };
}
