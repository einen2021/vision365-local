/**
 * Unified API client — routes to Next.js API (web) or local Hono server (desktop).
 */

import { isDesktop, getDesktopApiPort, setDesktopApiPort } from "./platform";

/** Fixed port used by the Tauri app (must match src-tauri/src/lib.rs API_PORT) */
export const DESKTOP_API_PORT = 47821;

let cachedBaseUrl: string | null = null;

export function resetApiBaseUrl(): void {
  cachedBaseUrl = null;
}

export function getApiBaseUrl(): string {
  if (isDesktop()) {
    const port = getDesktopApiPort() || DESKTOP_API_PORT;
    const url = `http://127.0.0.1:${port}`;
    cachedBaseUrl = url;
    return url;
  }

  if (!cachedBaseUrl) cachedBaseUrl = "";
  return cachedBaseUrl;
}

export function apiUrl(path: string): string {
  const base = getApiBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}

/** Wait until the desktop API server responds to /health */
export async function waitForDesktopApi(timeoutMs = 60000): Promise<void> {
  if (!isDesktop()) return;

  const port = getDesktopApiPort() || DESKTOP_API_PORT;
  setDesktopApiPort(port);
  resetApiBaseUrl();

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (health.ok) {
        // Verify database is readable
        const dbCheck = await fetch(`http://127.0.0.1:${port}/api/db`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "list", path: ["UserDB"] }),
          signal: AbortSignal.timeout(3000),
        });
        if (dbCheck.ok) return;
      }
    } catch {
      // Server still starting
    }

    await new Promise((r) => setTimeout(r, 400));
  }

  throw new Error(
    "Local database server failed to start. Please restart the application.",
  );
}

export async function apiFetch(
  path: string,
  options?: RequestInit,
): Promise<Response> {
  if (isDesktop()) {
    await waitForDesktopApi();
  }
  return fetch(apiUrl(path), options);
}

export async function apiPost<T = unknown>(
  path: string,
  body: unknown,
): Promise<T> {
  const res = await apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || "API request failed");
  }
  return res.json() as Promise<T>;
}

/** Resolve image/upload URLs for desktop local file serving */
export function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  if (isDesktop()) {
    const base = getApiBaseUrl();
    if (!base) return url;
    if (url.startsWith("/local/")) return `${base}${url}`;
    if (url.startsWith("/uploads/")) return `${base}/local/${url.slice(1)}`;
    if (url.startsWith("/floor-plans/")) return `${base}/local/${url.slice(1)}`;
  }

  return url;
}
