/**
 * Helper to check whether debug / demo mode is active.
 * Checked on both client and server sides.
 */
export function isDebugMode() {
  if (typeof window !== "undefined") {
    if (window.__VISION365_DEBUG_MODE__ !== undefined) {
      return Boolean(window.__VISION365_DEBUG_MODE__);
    }
    try {
      const stored = localStorage.getItem("vision365:debugMode");
      if (stored === "true") return true;
      if (stored === "false") return false;
    } catch {
      // ignore
    }
  }

  const envVal =
    process.env.NEXT_PUBLIC_DEBUG_MODE ||
    process.env.DEBUG_MODE ||
    process.env.NEXT_PUBLIC_DEMO_MODE;

  return envVal === "true" || envVal === "1";
}
