/**
 * Platform detection — web (Next.js dev) vs desktop (Tauri).
 */

export function isDesktop(): boolean {
  if (typeof window === "undefined") return false;
  return "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
}

export function isWeb(): boolean {
  return !isDesktop();
}

export function getDesktopApiPort(): number | null {
  if (typeof window === "undefined") return null;
  const port = (window as Window & { __VISION365_API_PORT__?: number }).__VISION365_API_PORT__;
  return port ?? null;
}

export function setDesktopApiPort(port: number): void {
  if (typeof window !== "undefined") {
    (window as Window & { __VISION365_API_PORT__?: number }).__VISION365_API_PORT__ = port;
  }
}

/** Default desktop API port (matches Tauri backend) */
export const DESKTOP_API_PORT = 47821;

export function isDesktopApiReady(): boolean {
  return getDesktopApiPort() != null && getDesktopApiPort()! > 0;
}
