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
      const existing = (getDocument(snapshot, row.path) || {}) as Record<string, unknown>;
      const updated = { ...existing };
      applyUpdate(updated, row.data || {});
      setDocument(snapshot, row.path, updated, false);
    } else if (row.type === "delete") {
      deleteDocument(snapshot, row.path);
    }
  }
}

db.post("/", async (c) => {
  try {
    const body = await c.req.json();

    switch (body.op) {
      case "get": {
        const snapshot = await readDb();
        const data = getDocument(snapshot, body.path);
        return c.json({ exists: data !== null && data !== undefined, data: data ?? {} });
      }
      case "list": {
        const snapshot = await readDb();
        const docs = listCollection(snapshot, body.path);
        const filtered = applyConstraints(docs, body.constraints || []);
        return c.json({ docs: filtered.map((d) => ({ id: d.id, data: d.data })) });
      }
      case "set": {
        await withDb((snapshot) => {
          setDocument(snapshot, body.path, body.data, body.merge === true);
          return null;
        });
        return c.json({ ok: true });
      }
      case "update": {
        await withDb((snapshot) => {
          const existing = (getDocument(snapshot, body.path) || {}) as Record<string, unknown>;
          const updated = { ...existing };
          applyUpdate(updated, body.data);
          setDocument(snapshot, body.path, updated, false);
          return null;
        });
        return c.json({ ok: true });
      }
      case "delete": {
        await withDb((snapshot) => {
          deleteDocument(snapshot, body.path);
          return null;
        });
        return c.json({ ok: true });
      }
      case "add": {
        const id = await withDb((snapshot) => {
          const newId = generateId();
          setDocument(snapshot, [...body.path, newId], body.data, false);
          return newId;
        });
        return c.json({ id });
      }
      case "batch": {
        await withDb((snapshot) => {
          applyBatch(snapshot, body.operations);
          return null;
        });
        return c.json({ ok: true });
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
