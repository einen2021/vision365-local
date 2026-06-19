"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { setDesktopApiPort } from "@/lib/platform";
import { resetApiBaseUrl, waitForDesktopApi, DESKTOP_API_PORT, primeAssetUrlResolver } from "@/lib/apiClient";

/**
 * Blocks the UI until the local database server is running.
 * Shows a splash screen on desktop; no-op on web.
 */
export function DesktopProvider({ children }) {
  const [status, setStatus] = useState("checking");
  const [errorMsg, setErrorMsg] = useState("");
  const [logHint, setLogHint] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isTauri =
      "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
    if (!isTauri) {
      primeAssetUrlResolver();
      setStatus("ready");
      return;
    }

    let apiErrorReceived = false;

    async function initDesktop() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");

        setDesktopApiPort(DESKTOP_API_PORT);
        resetApiBaseUrl();

        await listen("vision365-api-ready", (event) => {
          const port = event.payload;
          if (typeof port === "number" && port > 0) {
            setDesktopApiPort(port);
            resetApiBaseUrl();
          }
        });

        await listen("vision365-api-error", async (event) => {
          apiErrorReceived = true;
          const log = await invoke("get_server_log").catch(() => "");
          const payload = String(event.payload || "Database failed to start");
          setErrorMsg(payload);
          if (log) setLogHint(log.slice(-600));
          setStatus("error");
        });

        // Give Rust setup time to finish
        await new Promise((r) => setTimeout(r, 500));

        if (apiErrorReceived) return;

        const ready = await invoke("is_db_ready");
        if (ready === true) {
          setStatus("ready");
          return;
        }

        await waitForDesktopApi(90000);
        setStatus("ready");
      } catch (err) {
        console.error("[DesktopProvider]", err);
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          const log = await invoke("get_server_log").catch(() => "");
          if (log) setLogHint(log.slice(-600));
        } catch {
          // ignore
        }
        setErrorMsg(
          err?.message ||
            "Local database server failed to start. Please restart the application."
        );
        setStatus("error");
      }
    }

    initDesktop();
  }, []);

  if (status === "checking") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <Loader2 className="h-10 w-10 animate-spin text-primary" />
        <div className="text-center">
          <p className="text-lg font-semibold">Starting Vision365</p>
          <p className="text-sm text-muted-foreground">
            Initialising local database...
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
        <p className="text-lg font-semibold text-destructive">Database Error</p>
        <p className="max-w-lg text-center text-sm text-muted-foreground whitespace-pre-wrap">
          {errorMsg}
        </p>
        {logHint ? (
          <pre className="max-w-lg overflow-auto rounded bg-muted p-3 text-left text-xs text-muted-foreground">
            {logHint}
          </pre>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Log file: %APPDATA%\Vision365\logs\server.log
        </p>
        <button
          type="button"
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
          onClick={() => window.location.reload()}
        >
          Retry
        </button>
      </div>
    );
  }

  return children;
}
