import { Hono } from "hono";
import { type AppPaths } from "../services/storageService";
import { saveUpload, deleteUpload } from "../services/uploadService";
import { safePath } from "../services/storageService";
import fs from "fs";
import path from "path";

export function createUploadRoutes(paths: AppPaths) {
  const upload = new Hono();

  upload.post("/", async (c) => {
    try {
      const formData = await c.req.formData();
      const file = formData.get("file");
      const storagePath = (formData.get("path") as string) || "uploads";

      if (!file || typeof file === "string") {
        return c.json({ error: "No file provided" }, 400);
      }

      const buffer = Buffer.from(await (file as File).arrayBuffer());
      const result = await saveUpload(
        paths,
        { name: (file as File).name, type: (file as File).type, buffer },
        storagePath
      );

      return c.json({ url: result.url, path: result.path });
    } catch (error) {
      console.error("[upload]", error);
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  upload.delete("/", async (c) => {
    try {
      const { path: filePath } = await c.req.json();
      if (!filePath) return c.json({ error: "No path" }, 400);
      await deleteUpload(paths, filePath);
      return c.json({ ok: true });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 500);
    }
  });

  /** Serve local files */
  upload.get("/local/*", (c) => {
    const relativePath = c.req.path.replace("/local/", "");
    const fullPath = safePath(paths.root, relativePath);

    if (!fs.existsSync(fullPath)) {
      return c.json({ error: "File not found" }, 404);
    }

    const buffer = fs.readFileSync(fullPath);
    const ext = path.extname(fullPath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".pdf": "application/pdf",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
    };

    return new Response(buffer, {
      headers: { "Content-Type": mimeTypes[ext] || "application/octet-stream" },
    });
  });

  return upload;
}
