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

/**
 * Poll until the local Hono API answers /health.
 * Prevents "socket hang up" when Next rewrites to an API that is still booting Mongo.
 */
async function waitForLocalHonoApi(timeoutMs = 45000): Promise<string> {
  const existing = await resolveWebApiBaseUrl();
  if (existing) return existing;

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    webDesktopApiBase = undefined;
    webDesktopApiLastCheck = 0;
    const base = await resolveWebApiBaseUrl();
    if (base) return base;
    await new Promise((r) => setTimeout(r, 400));
  }

  throw new Error(
    "Local API is not running yet. Wait for desktop:dev (API on port 47821) to finish starting, then try again.",
  );
}

/** Map Node/undici network failures into a clear UI message. */
function friendlyFetchError(error: unknown): Error {
  const err = error as Error & { cause?: Error };
  const raw = `${err?.message || ""} ${err?.cause?.message || ""}`.toLowerCase();

  if (
    raw.includes("socket hang up") ||
    raw.includes("econnreset") ||
    raw.includes("econnrefused") ||
    raw.includes("fetch failed") ||
    raw.includes("failed to fetch") ||
    raw.includes("networkerror")
  ) {
    return new Error(
      "Local API connection dropped (socket hang up). Wait until Mongo/API finishes starting, then reconnect.",
    );
  }

  return err instanceof Error ? err : new Error(String(error));
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
    try {
      return await fetch(apiUrl(path), options);
    } catch (error) {
      throw friendlyFetchError(error);
    }
  }

  const normalized = path.startsWith("/") ? path : `/${path}`;
  // Telnet and other desktop APIs need Hono — wait instead of proxying into a dead port.
  const needsDesktopApi =
    normalized.startsWith("/api/telnet/") ||
    normalized.startsWith("/api/db") ||
    normalized.startsWith("/local/");

  try {
    let base = await resolveWebApiBaseUrl();
    if (!base && needsDesktopApi) {
      base = await waitForLocalHonoApi();
    }
    const url = base ? `${base}${normalized}` : normalized;
    return await fetch(url, options);
  } catch (error) {
    throw friendlyFetchError(error);
  }
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
