import { isDesktop } from "@/lib/platform";

/**
 * Triggers an immediate emergency exit of the application.
 * In desktop (Tauri) mode, invokes the backend emergency_exit command.
 * In web mode, attempts window.close() with fallback.
 */
export async function triggerEmergencyExit() {
  if (isDesktop()) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("emergency_exit");
      return;
    } catch (err) {
      console.error("[appControl] emergency_exit invoke failed:", err);
    }
  }

  try {
    window.close();
  } catch {
    // ignore
  }

  try {
    window.location.href = "about:blank";
  } catch {
    // ignore
  }
}

/**
 * Restarts / refreshes the application.
 * Reloads the webview, re-executing startup sync and re-establishing panel connections.
 */
export function triggerRestartApp() {
  window.location.reload();
}
