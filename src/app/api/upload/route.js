import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

/** File upload API — replaces Firebase Storage */
export async function POST(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const storagePath = formData.get("path") || "uploads";

    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const safeName = String(file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const relativePath = `${storagePath}/${Date.now()}_${safeName}`;
    const fullPath = path.join(process.cwd(), "public", relativePath);

    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, buffer);

    return NextResponse.json({
      url: `/${relativePath.replace(/\\/g, "/")}`,
      path: relativePath,
    });
  } catch (error) {
    console.error("[api/upload]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const { path: filePath } = await request.json();
    if (!filePath) {
      return NextResponse.json({ error: "No path" }, { status: 400 });
    }

    const relative = filePath.replace(/^\//, "");
    const fullPath = path.join(process.cwd(), "public", relative);
    await fs.unlink(fullPath).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
