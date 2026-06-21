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
  constructor(id, data, exists) {
    this.id = id;
    this._data = data;
    this._exists = exists;
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
    (d) => new DocumentSnapshot(d.id, d.data, true),
  );
  return new QuerySnapshot(docs);
}

export async function getDoc(docRef) {
  const result = await apiCall({ op: "get", path: docRef._path });
  return new DocumentSnapshot(docRef.id, result.data, result.exists);
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

/** Poll-based real-time listener (replaces Firebase onSnapshot) */
export function onSnapshot(ref, onNext, onError) {
  let active = true;
  let lastJson = "";

  async function poll() {
    if (!active) return;
    try {
      let snapshot;
      if (ref instanceof DocumentReference) {
        snapshot = await getDoc(ref);
      } else if (ref instanceof Query) {
        snapshot = await getDocs(ref);
      } else {
        snapshot = await getDocs(ref);
      }
      const json = JSON.stringify(
        ref instanceof DocumentReference
          ? snapshot.data()
          : snapshot.docs.map((d) => ({ id: d.id, ...d.data() })),
      );
      if (json !== lastJson) {
        lastJson = json;
        onNext(snapshot);
      }
    } catch (err) {
      if (onError) onError(err);
    }
    if (active) setTimeout(poll, 500);
  }

  poll();

  return () => {
    active = false;
  };
}
