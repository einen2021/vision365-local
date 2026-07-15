/**
 * Unified API client — routes to Next.js API (web) or local Hono server (desktop).
 */

import { isDesktop, getDesktopApiPort, setDesktopApiPort } from "./platform";

/** Fixed port used by the Tauri app (must match src-tauri/src/lib.rs API_PORT) */
export const DESKTOP_API_PORT = 47821;

let cachedBaseUrl: string | null = null;
/** undefined = not checked yet; "" = last check failed (retry after cooldown) */
let webDesktopApiBase: string | undefined;
let webDesktopApiLastCheck = 0;
const WEB_API_RECHECK_MS = 2000;

/** Once the desktop API is confirmed up, skip health/db probes on every request. */
let desktopApiReady = false;

export function resetApiBaseUrl(): void {
  cachedBaseUrl = null;
  webDesktopApiBase = undefined;
  webDesktopApiLastCheck = 0;
  desktopApiReady = false;
}

/** Parse API JSON safely — avoids cryptic errors when HTML error pages are returned */
export async function parseApiJsonResponse(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    if (text.trimStart().startsWith("<")) {
      throw new Error(
        "Local API unavailable. Start the desktop server with: npm run desktop:dev",
      );
    }
    throw new Error(text.slice(0, 200) || `Request failed (${res.status})`);
  }
  return res.json();
}

/** In browser dev, use the local Hono server when desktop:dev is running. */
async function resolveWebApiBaseUrl(): Promise<string> {
  const now = Date.now();
  if (
    webDesktopApiBase !== undefined &&
    (webDesktopApiBase !== "" || now - webDesktopApiLastCheck < WEB_API_RECHECK_MS)
  ) {
    return webDesktopApiBase;
  }

  webDesktopApiLastCheck = now;

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
  if (desktopApiReady) return;

  const port = getDesktopApiPort() || DESKTOP_API_PORT;
  setDesktopApiPort(port);

  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const health = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (health.ok) {
        // Verify database is readable (only required for the first ready check).
        const dbCheck = await fetch(`http://127.0.0.1:${port}/api/db`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op: "list", path: ["UserDB"] }),
          signal: AbortSignal.timeout(3000),
        });
        if (dbCheck.ok) {
          desktopApiReady = true;
          return;
        }
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
  // Fall back to same-origin /api when health check fails — Next.js rewrites to Hono
  const url = base ? `${base}${normalized}` : normalized;
  return fetch(url, options);
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

/** Normalize stored asset paths to /local/... URLs served by the desktop API. */
export function normalizeLocalAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  let path = url.startsWith("/") ? url : `/${url}`;
  if (path.startsWith("/local/")) return path;
  if (path.startsWith("local/")) return `/${path}`;
  if (path.startsWith("/floor-plans/") || path.startsWith("/uploads/")) {
    return `/local${path}`;
  }
  if (path.startsWith("floor-plans/") || path.startsWith("uploads/")) {
    return `/local/${path}`;
  }
  return path;
}

export function resolveAssetUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith("blob:") || url.startsWith("data:")) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;

  const path = normalizeLocalAssetUrl(url);

  if (path.startsWith("/local/")) {
    const base =
      getResolvableApiBase() ||
      (typeof window !== "undefined"
        ? `http://127.0.0.1:${DESKTOP_API_PORT}`
        : "");
    if (base) return encodeURI(`${base}${path}`);
    // Web without local API — use bundled public/ copy for floor plans
    if (path.startsWith("/local/floor-plans/")) {
      return encodeURI(path.replace("/local", ""));
    }
    return encodeURI(path);
  }

  return encodeURI(path);
}

/** Resolve /local/ asset URLs in Tauri (local API first, then convertFileSrc). */
export async function resolveDesktopAssetUrl(url: string): Promise<string> {
  const normalized = normalizeLocalAssetUrl(url);
  if (!normalized) return normalized;
  if (!isDesktop() || !normalized.startsWith("/local/")) {
    return resolveAssetUrl(normalized);
  }

  // Serve via the desktop API — same resolver as uploads; handles spaces and legacy paths.
  try {
    await waitForDesktopApi();
    const httpUrl = resolveAssetUrl(normalized);
    const res = await fetch(httpUrl);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 0) {
        return URL.createObjectURL(blob);
      }
    }
    console.warn(
      "[resolveDesktopAssetUrl] HTTP fetch failed:",
      res.status,
      httpUrl,
    );
  } catch (err) {
    console.warn("[resolveDesktopAssetUrl] HTTP fetch error", err);
  }

  let decodedUrl = normalized;
  try {
    decodedUrl = decodeURI(normalized);
  } catch {
    // keep normalized
  }

  try {
    const { invoke, convertFileSrc } = await import("@tauri-apps/api/core");
    const filePath = (await invoke("resolve_local_asset_src", {
      url: decodedUrl,
    })) as string;
    return convertFileSrc(filePath);
  } catch (err) {
    console.warn("[resolveDesktopAssetUrl] convertFileSrc failed", err);
  }

  return resolveAssetUrl(normalized);
}
