/**
 * Client-side Firebase Storage mock — saves files via local API (web or desktop).
 */

import { apiFetch } from "./apiClient";

class StorageReference {
  constructor(path) {
    this.fullPath = path;
  }
}

export function ref(storage, path) {
  return new StorageReference(path);
}

export async function uploadBytes(storageRef, file) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("path", storageRef.fullPath.replace(/\/[^/]+$/, "") || "uploads");

  const res = await apiFetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  storageRef._downloadUrl = data.url;
  return { ref: storageRef };
}

export async function getDownloadURL(storageRef) {
  if (storageRef._downloadUrl) return storageRef._downloadUrl;
  return `/${storageRef.fullPath}`;
}

export async function deleteObject(storageRef) {
  await apiFetch("/api/upload", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: storageRef._downloadUrl || storageRef.fullPath }),
  });
}

export async function listAll(storageRef) {
  return { items: [], prefixes: [] };
}
