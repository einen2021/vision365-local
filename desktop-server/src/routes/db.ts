import { Hono } from "hono";
import {
  readDb,
  getDocument,
  setDocument,
  deleteDocument,
  listCollection,
  applyConstraints,
  applyUpdate,
  generateId,
  withDbPaths,
  getDbRevision,
  getPathRevision,
  getCollectionChanges,
} from "../db/documentStore";

const db = new Hono();

function applyBatch(snapshot: Record<string, unknown>, operations: unknown[]) {
  for (const op of operations || []) {
    const row = op as {
      type: string;
      path: string[];
      data?: Record<string, unknown>;
      options?: { merge?: boolean };
    };
    if (row.type === "set") {
      setDocument(snapshot, row.path, row.data, row.options?.merge === true);
    } else if (row.type === "update") {
      const existing = (getDocument(snapshot, row.path) || {}) as Record<
        string,
        unknown
      >;
      const updated = { ...existing };
      applyUpdate(updated, row.data || {});
      setDocument(snapshot, row.path, updated, false);
    } else if (row.type === "delete") {
      deleteDocument(snapshot, row.path);
    }
  }
}

/** Path array from the ?path= query param (JSON), or null. */
function parsePathParam(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((p) => typeof p === "string") ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Cheap realtime poll — clients check revision before refetching documents.
 * With ?path=["Coll","doc"] the revision only changes when that path (or
 * something below / above it) is written, not on every write in the database.
 */
db.get("/revision", (c) => {
  const path = parsePathParam(c.req.query("path"));
  return c.json({ revision: path ? getPathRevision(path) : getDbRevision() });
});

const HISTORY_DEDUPE_WINDOW_MS = 30_000;
/** History arrays are appended in time order — only the tail can hold a duplicate. */
const HISTORY_DEDUPE_SCAN = 500;

function historyRowKey(row: Record<string, unknown> | null | undefined) {
  return String(row?.message || row?.rawMessage || "").trim();
}

/** Append rows to an array field, skipping a row already seen within the dedupe window. */
function appendRowsToArray(existing: unknown, rows: Record<string, unknown>[]) {
  const list = Array.isArray(existing) ? [...existing] : [];
  let appended = 0;
  for (const row of rows) {
    const key = historyRowKey(row);
    const time = Number(row?.time) || 0;
    let duplicate = false;
    for (let i = list.length - 1; i >= Math.max(0, list.length - HISTORY_DEDUPE_SCAN); i--) {
      const ex = list[i] as Record<string, unknown>;
      if (historyRowKey(ex) !== key) continue;
      const exTime = Number(ex?.time) || 0;
      if (exTime === time || Math.abs(time - exTime) < HISTORY_DEDUPE_WINDOW_MS) {
        duplicate = true;
        break;
      }
    }
    if (!duplicate) {
      list.push(row);
      appended += 1;
    }
  }
  return { list, appended };
}

db.post("/", async (c) => {
  try {
    const body = await c.req.json();

    switch (body.op) {
      case "revision": {
        return c.json({ revision: getDbRevision() });
      }
      case "get": {
        const snapshot = readDb();
        const data = getDocument(snapshot, body.path);
        return c.json({
          exists: data !== null && data !== undefined,
          data: data ?? {},
          revision: getDbRevision(),
          pathRevision: getPathRevision(body.path),
        });
      }
      case "list": {
        const snapshot = readDb();
        const docs = listCollection(snapshot, body.path);
        const filtered = applyConstraints(docs, body.constraints || []);
        return c.json({
          docs: filtered.map((d) => ({ id: d.id, data: d.data })),
          revision: getDbRevision(),
          pathRevision: getPathRevision(body.path),
        });
      }
      case "changes": {
        // Docs of a collection changed since body.since — { full: true } means refetch.
        const changes = getCollectionChanges(readDb(), body.path, Number(body.since));
        return c.json(changes ? { full: false, ...changes } : { full: true });
      }
      case "appendRows": {
        // Server-side history append: body.targets = [{ path: [col, docId], field }],
        // body.rows = [...]. Avoids downloading and re-uploading whole history arrays.
        const targets = ((body.targets || []) as { path: string[]; field: string }[]).filter(
          (t) => Array.isArray(t?.path) && t.path.length > 0 && t.field,
        );
        const rows = (Array.isArray(body.rows) ? body.rows : []) as Record<string, unknown>[];
        if (targets.length === 0 || rows.length === 0) {
          return c.json({ ok: true, appended: 0 });
        }
        const appended = await withDbPaths(
          targets.map((t) => t.path),
          (snapshot) => {
            let total = 0;
            for (const target of targets) {
              const existingDoc = (getDocument(snapshot, target.path) || {}) as Record<string, unknown>;
              const { list, appended: n } = appendRowsToArray(existingDoc[target.field], rows);
              if (n > 0) {
                setDocument(snapshot, target.path, { ...existingDoc, [target.field]: list }, false);
                total += n;
              }
            }
            return total;
          },
        );
        return c.json({ ok: true, appended, revision: getDbRevision() });
      }
      case "set": {
        await withDbPaths([body.path], (snapshot) => {
          setDocument(snapshot, body.path, body.data, body.merge === true);
          return null;
        });
        return c.json({ ok: true, revision: getDbRevision() });
      }
      case "update": {
        await withDbPaths([body.path], (snapshot) => {
          const existing = (getDocument(snapshot, body.path) || {}) as Record<
            string,
            unknown
          >;
          const updated = { ...existing };
          applyUpdate(updated, body.data);
          setDocument(snapshot, body.path, updated, false);
          return null;
        });
        return c.json({ ok: true, revision: getDbRevision() });
      }
      case "delete": {
        await withDbPaths([body.path], (snapshot) => {
          deleteDocument(snapshot, body.path);
          return null;
        });
        return c.json({ ok: true, revision: getDbRevision() });
      }
      case "add": {
        const id = await withDbPaths([body.path], (snapshot) => {
          const newId = generateId();
          setDocument(snapshot, [...body.path, newId], body.data, false);
          return newId;
        });
        return c.json({ id, revision: getDbRevision() });
      }
      case "batch": {
        const paths = ((body.operations || []) as { path: string[] }[]).map((op) => op.path);
        await withDbPaths(paths, (snapshot) => {
          applyBatch(snapshot, body.operations);
          return null;
        });
        return c.json({ ok: true, revision: getDbRevision() });
      }
      default:
        return c.json({ error: "Unknown operation" }, 400);
    }
  } catch (error) {
    console.error("[db]", error);
    return c.json({ error: (error as Error).message }, 500);
  }
});

export default db;
