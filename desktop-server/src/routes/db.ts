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
  withDb,
  getDbRevision,
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

/** Cheap realtime poll — clients check revision before refetching documents. */
db.get("/revision", (c) => {
  return c.json({ revision: getDbRevision() });
});

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
        });
      }
      case "list": {
        const snapshot = readDb();
        const docs = listCollection(snapshot, body.path);
        const filtered = applyConstraints(docs, body.constraints || []);
        return c.json({
          docs: filtered.map((d) => ({ id: d.id, data: d.data })),
          revision: getDbRevision(),
        });
      }
      case "set": {
        await withDb((snapshot) => {
          setDocument(snapshot, body.path, body.data, body.merge === true);
          return null;
        });
        return c.json({ ok: true, revision: getDbRevision() });
      }
      case "update": {
        await withDb((snapshot) => {
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
        await withDb((snapshot) => {
          deleteDocument(snapshot, body.path);
          return null;
        });
        return c.json({ ok: true, revision: getDbRevision() });
      }
      case "add": {
        const id = await withDb((snapshot) => {
          const newId = generateId();
          setDocument(snapshot, [...body.path, newId], body.data, false);
          return newId;
        });
        return c.json({ id, revision: getDbRevision() });
      }
      case "batch": {
        await withDb((snapshot) => {
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
