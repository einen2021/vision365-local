import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getCollection } from "../db/client";
import {
  type AppPaths,
  safePath,
  getCategoryForMime,
  MAX_FILE_SIZE,
} from "./storageService";
import { generateId } from "../db/documentStore";

export interface UploadResult {
  url: string;
  path: string;
  id: string;
  size: number;
  mimeType: string;
}

function sanitizeFilename(name: string): string {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getCategoryDir(paths: AppPaths, category: string): string {
  const map: Record<string, string> = {
    images: paths.images,
    videos: paths.videos,
    documents: paths.documents,
    audio: paths.audio,
    temp: paths.temp,
    "floor-plans": paths.floorPlans,
  };
  return map[category] || paths.uploads;
}

export async function saveUpload(
  paths: AppPaths,
  file: { name: string; type: string; buffer: Buffer },
  storagePath?: string
): Promise<UploadResult> {
  if (file.buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }

  const category = storagePath?.includes("floor-plans")
    ? "floor-plans"
    : getCategoryForMime(file.type, storagePath);

  const safeName = sanitizeFilename(file.name);
  const timestamp = Date.now();
  const storedName = `${timestamp}_${safeName}`;
  const categoryDir = getCategoryDir(paths, category);

  let relativePath: string;
  if (storagePath) {
    const subPath = storagePath.replace(/^uploads\/?/, "").replace(/^\//, "");
    relativePath = path.join("uploads", subPath, storedName).replace(/\\/g, "/");
    const targetDir = safePath(paths.root, "uploads", subPath);
    fs.mkdirSync(targetDir, { recursive: true });
    const fullPath = path.join(targetDir, storedName);
    fs.writeFileSync(fullPath, file.buffer);
  } else {
    relativePath = path.join("uploads", category, storedName).replace(/\\/g, "/");
    const fullPath = safePath(categoryDir, storedName);
    fs.writeFileSync(fullPath, file.buffer);
  }

  const checksum = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const fileId = generateId();
  const now = new Date().toISOString();

  const files = getCollection("files");
  await files.insertOne({
    _id: fileId,
    id: fileId,
    category,
    original_name: file.name,
    stored_name: storedName,
    relative_path: relativePath,
    mime_type: file.type || "application/octet-stream",
    size_bytes: file.buffer.length,
    checksum,
    created_at: now,
  });

  return {
    url: `/local/${relativePath}`,
    path: relativePath,
    id: fileId,
    size: file.buffer.length,
    mimeType: file.type,
  };
}

export async function deleteUpload(paths: AppPaths, filePath: string): Promise<void> {
  const relative = filePath.replace(/^\/local\//, "").replace(/^\//, "");
  const fullPath = safePath(paths.root, relative);

  if (fs.existsSync(fullPath)) {
    fs.unlinkSync(fullPath);
  }

  const files = getCollection("files");
  await files.deleteOne({ relative_path: relative });
}

export async function getFileMetadata(fileId: string) {
  const files = getCollection("files");
  return files.findOne({ id: fileId });
}
