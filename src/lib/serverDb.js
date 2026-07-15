import { getCollection } from "./mongoClient";

const SNAPSHOT_ID = 1;
const COLLECTION = "db_snapshot";

let dbLock = Promise.resolve();

async function withLock(fn) {
  let release;
  const gate = new Promise((resolve) => {
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

/** Read the full document database from MongoDB */
export async function readDb() {
  const collection = await getCollection(COLLECTION);
  const doc = await collection.findOne({ _id: SNAPSHOT_ID });
  if (!doc?.data || typeof doc.data !== "object") return {};
  return doc.data;
}

/** Write the full document database to MongoDB */
export async function writeDb(data) {
  const collection = await getCollection(COLLECTION);
  const now = new Date().toISOString();
  await collection.updateOne(
    { _id: SNAPSHOT_ID },
    { $set: { data, updated_at: now } },
    { upsert: true }
  );
}

/** One transactional read → mutate → write */
export async function mutateDb(mutator) {
  return withLock(async () => {
    const snapshot = await readDb();
    const result = await mutator(snapshot);
    await writeDb(snapshot);
    return result;
  });
}

function resolveCollection(db, segments) {
  if (!segments || segments.length === 0) return null;

  let nested = db;
  let nestedOk = true;
  for (const key of segments) {
    if (nested == null || typeof nested !== "object" || nested[key] === undefined) {
      nestedOk = false;
      break;
    }
    nested = nested[key];
  }
  if (nestedOk && nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested;
  }

  const joined = segments.join("/");
  const flat = db[joined];
  if (flat && typeof flat === "object" && !Array.isArray(flat)) {
    return flat;
  }

  if (segments.length > 1) {
    const head = segments[0];
    const tail = segments.slice(1).join("/");
    const partial = db[head]?.[tail];
    if (partial && typeof partial === "object" && !Array.isArray(partial)) {
      return partial;
    }
  }

  return null;
}

function ensureCollection(db, segments) {
  const existing = resolveCollection(db, segments);
  if (existing) return existing;

  if (segments.length === 3 && segments[1] === "asset") {
    const key = `${segments[0]}/asset/${segments[2]}`;
    if (!db[key] || typeof db[key] !== "object") {
      db[key] = {};
    }
    return db[key];
  }

  let current = db;
  for (const key of segments) {
    if (current[key] === undefined || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key];
  }
  return current;
}

function getParent(db, segments) {
  if (segments.length === 1) {
    return { parent: db, lastKey: segments[0] };
  }

  const docId = segments[segments.length - 1];
  const collectionSegments = segments.slice(0, -1);
  const collection = ensureCollection(db, collectionSegments);
  return { parent: collection, lastKey: docId };
}

export function getDocument(db, segments) {
  if (!segments || segments.length === 0) return null;

  if (segments.length === 1) {
    const node = db[segments[0]];
    return node ?? null;
  }

  const docId = segments[segments.length - 1];
  const collection = resolveCollection(db, segments.slice(0, -1));
  if (collection && collection[docId] !== undefined) {
    return collection[docId];
  }

  return null;
}

export function setDocument(db, segments, data, merge = false) {
  const { parent, lastKey } = getParent(db, segments);
  if (merge) {
    // Honor deleteField() / __deleteField instead of storing the marker object.
    const existing =
      parent[lastKey] && typeof parent[lastKey] === "object" && !Array.isArray(parent[lastKey])
        ? { ...parent[lastKey] }
        : {};
    applyUpdate(existing, data || {});
    parent[lastKey] = existing;
  } else {
    parent[lastKey] = data;
  }
}

export function deleteDocument(db, segments) {
  const collection =
    segments.length > 1 ? resolveCollection(db, segments.slice(0, -1)) : db;
  if (collection) {
    delete collection[segments[segments.length - 1]];
  }
}

export function listCollection(db, segments) {
  const current = resolveCollection(db, segments);
  if (!current || typeof current !== "object" || Array.isArray(current)) return [];

  return Object.entries(current).map(([id, data]) => ({
    id,
    data: typeof data === "object" && data !== null ? data : { value: data },
  }));
}

export function applyConstraints(docs, constraints = []) {
  let result = [...docs];

  for (const c of constraints) {
    if (c.type === "where") {
      result = result.filter((doc) => {
        const val = doc.data[c.field];
        if (c.op === "==") return val === c.value;
        if (c.op === "!=") return val !== c.value;
        return true;
      });
    }
    if (c.type === "orderBy") {
      result.sort((a, b) => {
        const av = a.data[c.field];
        const bv = b.data[c.field];
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return c.direction === "desc" ? -cmp : cmp;
      });
    }
    if (c.type === "limit") {
      result = result.slice(0, c.count);
    }
  }

  return result;
}

export function applyUpdate(target, updates) {
  for (const [key, value] of Object.entries(updates)) {
    if (value && value.__arrayUnion) {
      const existing = Array.isArray(target[key]) ? target[key] : [];
      const merged = [...existing];
      for (const item of value.__arrayUnion) {
        if (!merged.some((e) => JSON.stringify(e) === JSON.stringify(item))) {
          merged.push(item);
        }
      }
      target[key] = merged;
    } else if (value && value.__deleteField) {
      delete target[key];
    } else {
      target[key] = value;
    }
  }
}

export function generateId() {
  return `doc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
