/**
 * Unified API client — routes to Next.js API (web) or local Hono server (desktop).
 */

import { isDesktop, getDesktopApiPort, setDesktopApiPort } from "./platform";

/** Fixed port used by the Tauri app (must match src-tauri/src/lib.rs API_PORT) */
export const DESKTOP_API_PORT = 47821;

let cachedBaseUrl: string | null = null;
/** undefined = not checked yet; "" = checked, unavailable */
let webDesktopApiBase: string | undefined;

export function resetApiBaseUrl(): void {
  cachedBaseUrl = null;
  webDesktopApiBase = undefined;
}

/** In browser dev, use the local Hono server when desktop:dev is running. */
async function resolveWebApiBaseUrl(): Promise<string> {
  if (webDesktopApiBase !== undefined) return webDesktopApiBase;

  try {
    const res = await fetch(`http://127.0.0.1:${DESKTOP_API_PORT}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    webDesktopApiBase = res.ok ? `http://127.0.0.1:${DESKTOP_API_PORT}` : "";
  } catch {
    webDesktopApiBase = "";
  }

  return webDesktopApiBase;
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
    return fetch(apiUrl(path), options);
  }

  const base = await resolveWebApiBaseUrl();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return fetch(`${base}${normalized}`, options);
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

/** Resolve image/upload URLs for local file serving (desktop app + desktop:dev). */
export async function primeAssetUrlResolver(): Promise<void> {
  if (!isDesktop()) await resolveWebApiBaseUrl();
}

function getResolvableApiBase(): string {
  if (isDesktop()) return getApiBaseUrl();
  return webDesktopApiBase ?? "";
}

export function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  const base = getResolvableApiBase();
  let path = url;

  // Legacy Firebase-style paths saved when upload fell back to mock storage
  if (path.startsWith("/floor-plans/")) {
    path = base
      ? `/local/uploads/${path.slice(1)}`
      : path;
  } else if (path.startsWith("/uploads/")) {
    path = `/local/${path.slice(1)}`;
  }

  if (path.startsWith("/local/")) {
    return base ? encodeURI(`${base}${path}`) : encodeURI(path);
  }

  return encodeURI(path);
}
