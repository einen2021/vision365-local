import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import {
  readDb,
  mutateDb,
  getDocument,
  setDocument,
  deleteDocument,
  listCollection,
  applyConstraints,
  applyUpdate,
  generateId,
} from "@/lib/serverDb";

/** Unified JSON database API — replaces Firebase Firestore */
export async function POST(request) {
  const bodyText = await request.text();
  const proxied = await tryProxyToDesktopServer(request, "/api/db", bodyText);
  if (proxied) return proxied;

  try {
    const body = JSON.parse(bodyText);

    switch (body.op) {
      case "get": {
        const db = await readDb();
        const data = getDocument(db, body.path);
        return NextResponse.json({
          exists: data !== null && data !== undefined,
          data: data ?? {},
        });
      }

      case "list": {
        const db = await readDb();
        const docs = listCollection(db, body.path);
        const filtered = applyConstraints(docs, body.constraints || []);
        return NextResponse.json({
          docs: filtered.map((d) => ({ id: d.id, data: d.data })),
        });
      }

      case "set": {
        await mutateDb((snapshot) => {
          setDocument(snapshot, body.path, body.data, body.merge === true);
        });
        return NextResponse.json({ ok: true });
      }

      case "update": {
        await mutateDb((snapshot) => {
          const existing = getDocument(snapshot, body.path) || {};
          const updated = { ...existing };
          applyUpdate(updated, body.data);
          setDocument(snapshot, body.path, updated, false);
        });
        return NextResponse.json({ ok: true });
      }

      case "delete": {
        await mutateDb((snapshot) => {
          deleteDocument(snapshot, body.path);
        });
        return NextResponse.json({ ok: true });
      }

      case "add": {
        const id = await mutateDb((snapshot) => {
          const newId = generateId();
          setDocument(snapshot, [...body.path, newId], body.data, false);
          return newId;
        });
        return NextResponse.json({ id });
      }

      case "batch": {
        await mutateDb((snapshot) => {
          for (const op of body.operations || []) {
            if (op.type === "set") {
              setDocument(snapshot, op.path, op.data, op.options?.merge === true);
            } else if (op.type === "update") {
              const existing = getDocument(snapshot, op.path) || {};
              const updated = { ...existing };
              applyUpdate(updated, op.data);
              setDocument(snapshot, op.path, updated, false);
            } else if (op.type === "delete") {
              deleteDocument(snapshot, op.path);
            }
          }
        });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: "Unknown operation" }, { status: 400 });
    }
  } catch (error) {
    console.error("[api/db]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
