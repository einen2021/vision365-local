"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Vision365Logo } from "@/components/vision365-logo";
import { Progress } from "@/components/ui/progress";
import { setDesktopApiPort } from "@/lib/platform";
import {
  resetApiBaseUrl,
  waitForDesktopApi,
  DESKTOP_API_PORT,
  primeAssetUrlResolver,
} from "@/lib/apiClient";
import { useStartupProgressStore } from "@/stores/startupProgressStore";

/**
 * Runs after the desktop DB/API is confirmed ready:
 * 1. Connects to the fire panel (step 6).
 * 2. Runs the full startup list sync (steps 7-11) in the background — querying counts,
 *    fetching & confirming lists, saving all data to DB, syncing assets,
 *    and recording to history.
 * 3. Step 12: All data saved -> closes splash screen.
 */
async function runPanelStartupSync() {
  const setProgress = useStartupProgressStore.getState().setProgress;
  setProgress({
    step: 6,
    total: 12,
    percent: 50,
    message: "Connecting to fire panel...",
  });

  try {
    const { useFirePanelStore } = await import("@/stores/firePanelStore");
    const connectPromise = useFirePanelStore.getState().ensureConnected();
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), 8000));
    const connected = await Promise.race([connectPromise, timeoutPromise]);

    if (connected) {
      setProgress({
        step: 6,
        total: 12,
        percent: 55,
        message: "Fire panel connected. Starting data synchronization...",
      });

      const { runStartupListSync } = await import("@/lib/startupListSync");
      await runStartupListSync();
    } else {
      console.log("[DesktopProvider] Fire panel offline or unreachable; continuing startup.");
      setProgress({
        step: 12,
        total: 12,
        percent: 100,
        message: "Fire panel offline - opening application...",
      });
      await new Promise((r) => setTimeout(r, 400));
      useStartupProgressStore.getState().closeSplash();
    }
  } catch (err) {
    console.warn("[DesktopProvider] Fire panel startup sync error:", err);
    useStartupProgressStore.getState().closeSplash();
  }
}

/**
 * Mounts the app in the background and displays the splash screen overlay.
 * Auto connection and startupListSync run in the background, updating progress,
 * and after saving all data, the splash closes automatically.
 */
export function DesktopProvider({ children }) {
  const [errorMsg, setErrorMsg] = useState("");
  const [logHint, setLogHint] = useState("");
  const { step, total, percent, message, isSplashOpen } = useStartupProgressStore();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const isTauri =
      "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
    if (!isTauri) {
      primeAssetUrlResolver();
      // On web, run background auto-connect & list sync then close splash
      runPanelStartupSync();
      return;
    }

    let apiErrorReceived = false;

    async function initDesktop() {
      try {
        const { listen } = await import("@tauri-apps/api/event");
        const { invoke } = await import("@tauri-apps/api/core");

        setDesktopApiPort(DESKTOP_API_PORT);
        resetApiBaseUrl();

        await listen("vision365-startup-progress", (event) => {
          const payload = event.payload;
          if (payload && typeof payload === "object") {
            const rawStep = Number(payload.step) || 1;
            const calculatedPercent = Math.min(
              45,
              Math.round((rawStep / 5) * 45),
            );
            useStartupProgressStore.getState().setProgress({
              step: rawStep,
              total: 12,
              percent: payload.percent ? Math.min(45, Math.round(payload.percent * 0.45)) : calculatedPercent,
              message: String(payload.message || "Initialising..."),
            });
          }
        });

        await listen("vision365-api-ready", (event) => {
          const port = event.payload;
          if (typeof port === "number" && port > 0) {
            setDesktopApiPort(port);
            resetApiBaseUrl();
          }
          useStartupProgressStore.getState().setProgress({
            step: 5,
            total: 12,
            percent: 45,
            message: "Database ready",
          });
        });

        await listen("vision365-api-error", async (event) => {
          apiErrorReceived = true;
          const log = await invoke("get_server_log").catch(() => "");
          const payload = String(event.payload || "Database failed to start");
          setErrorMsg(payload);
          if (log) setLogHint(log.slice(-600));
        });

        await new Promise((r) => setTimeout(r, 200));

        if (apiErrorReceived) return;

        const ready = await invoke("is_db_ready");
        if (ready === true) {
          await runPanelStartupSync();
          return;
        }

        useStartupProgressStore.getState().setProgress({
          step: 4,
          total: 12,
          percent: 35,
          message: "Connecting to database...",
        });

        await waitForDesktopApi(90000);

        await runPanelStartupSync();
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
            "Local database server failed to start. Please restart the application.",
        );
      }
    }

    initDesktop();
  }, []);

  return (
    <>
      {/* Background application tree mounts and runs immediately */}
      {children}

      {/* Splash Screen overlay on top while auto-connecting and syncing data */}
      {isSplashOpen && !errorMsg ? (
        <div className="fixed inset-0 z-[99999] flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-6">
          <Vision365Logo className="h-20 w-20" />
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <div className="w-full max-w-md space-y-3 text-center">
            <p className="text-lg font-semibold">Starting Vision365</p>
            <p className="text-sm text-muted-foreground">
              Step {step} of {total}
            </p>
            <p className="text-sm font-medium text-foreground">{message}</p>
            <div className="space-y-1">
              <Progress value={percent} className="h-2" />
              <p className="text-xs text-muted-foreground">{percent}%</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Database or Fatal Startup Error display */}
      {errorMsg ? (
        <div className="fixed inset-0 z-[99999] flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8">
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
      ) : null}
    </>
  );
}
