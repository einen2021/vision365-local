"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/contexts/AppContext";
import { useFireAlert } from "@/contexts/FireModalContext";
import { useLivePanelAlert } from "@/contexts/LivePanelAlertContext";
import { LIVE_PANEL_ROUTE_BY_LABEL } from "@/config/live-panel-routes";
import { useAutoPilotStore } from "@/stores/autoPilotStore";
import { useHeaderActionProgressStore } from "@/stores/headerActionProgressStore";
import { useFirePanelStore } from "@/stores/firePanelStore";
import { useAssetFireStatusStore } from "@/stores/assetFireStatusStore";
import { findAllDeviceAddressesByLocationText } from "@/lib/assetAddressFloorIndex";
import { collectDeviceAddressKeys, normalizeSimplexStatus } from "@/lib/assetFireStatus";
import { loginToPanel } from "@/lib/panelLogin";
import { AutoPilotNotices } from "@/components/autopilot-notices";

// Human-like pacing, all measured from the moment the message arrives (t0):
//   2s    click Acknowledge, then watch the panel logs up to 2s for the
//         button-ack line ("... SUPERVISORY ACKED AT NODE 1")
//   +0.5s login 333 ONCE for both Silence and Reset (retried every 1s until
//         ACCESS GRANTED) -> 1.5s -> Silence: set 2/3/4:p217 on
//   +1s   System Reset on the same login: set 2/3/4:p212 on
// Every gap between control commands stays under the panel worker's 3s
// CONTROL_QUIET_MS, so a held-back list dump never restarts mid-sequence (a
// dump makes the panel ignore typed logins). List re-syncs also wait while a
// run is active (holdListDumps). Pauses shrink to aim for AUTOPILOT_BUDGET_MS.
/** Acknowledge this long after the message arrives. */
const ACK_START_DELAY_MS = 2000;
/** After `ack` returns, watch this long for the "... ACKED AT NODE n" log line. */
const ACK_LOG_WAIT_MS = 2000;
/** Panel line written when an ack is accepted, e.g. "SUPERVISORY ACKED  AT NODE  1". */
const ACK_AT_NODE_RE = /ACKED\s+AT\s+NODE\s+\d+/i;
const ACK_COMMAND_TIMEOUT_MS = 2000;
/** Pauses before the remaining commands, in order: { desired, min } ms. */
const PACING = {
  /** Ack-log wait over → login. */
  afterAck: { desired: 500, min: 200 },
  /** ACCESS GRANTED → Silence (set p217). */
  silenceSettle: { desired: 1500, min: 1000 },
  /** Silence done → Reset (set p212), same login. */
  betweenActions: { desired: 1000, min: 300 },
};
const PACING_ORDER = ["afterAck", "silenceSettle", "betweenActions"];
/** Panel commands still to send after each pause (login / set batches). */
const COMMANDS_AFTER_PAUSE = { afterAck: 3, silenceSettle: 2, betweenActions: 1 };
/** Time kept free per remaining panel command. */
const COMMAND_RESERVE_MS = 500;
/** Message arrival → system reset done, target (pauses shrink to meet it). */
export const AUTOPILOT_BUDGET_MS = 15000;
const POST_RESET_WAIT_MS = 1500;
const POLL_MS = 50;

/** Lower runs first. STRICT: Fire > Trouble > Supervisory. */
const PRIORITY = { Fire: 0, Trouble: 1, Supervisory: 2 };

const ADDRESS_IN_TEXT_RE = /\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i;

class RunStopped extends Error {}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function normalizeLocation(value) {
  return String(value || "").toUpperCase().replace(/\s+/g, " ").trim();
}

/** F / T / S status flag per category. */
const FLAG_BY_LABEL = { Fire: "F", Trouble: "T", Supervisory: "S" };

function hasStatusFlag(address, flag) {
  const { panelLiveByAddress = {}, byDeviceAddress = {} } = useAssetFireStatusStore.getState();
  for (const key of collectDeviceAddressKeys(address)) {
    if (normalizeSimplexStatus(panelLiveByAddress[key])[flag] === 1) return true;
    if (normalizeSimplexStatus(byDeviceAddress[key])[flag] === 1) return true;
  }
  return false;
}

/**
 * Device address(es) for the messages of a run. A location shared by several
 * devices is narrowed to the one flagged for this category (F / T / S, from
 * `list f/t/s`); if that still is not exactly one device, it is left out —
 * never disable (or report) a guess.
 */
async function resolveDeviceAddresses(incidents, label = "Fire") {
  const flag = FLAG_BY_LABEL[label] || "F";
  const addresses = new Set();
  for (const { entry } of incidents) {
    const direct =
      entry.pointId ||
      entry.deviceAddress ||
      String(entry.raw || "").match(ADDRESS_IN_TEXT_RE)?.[0] ||
      "";
    if (direct) {
      addresses.add(direct);
      continue;
    }
    const candidates = await findAllDeviceAddressesByLocationText(entry.location || "");
    if (candidates.length === 1) {
      addresses.add(candidates[0]);
      continue;
    }
    const flagged = candidates.filter((address) => hasStatusFlag(address, flag));
    if (flagged.length === 1) addresses.add(flagged[0]);
  }
  return [...addresses];
}

/** "2:M1-32-0, 2:M1-33-0" — or the message location(s) when no address is known. */
function describeDevices(addresses, run) {
  if (addresses.length > 0) return addresses.join(", ");
  const locations = [...new Set(run.incidents.map((i) => i.location).filter(Boolean))];
  return locations.length > 0 ? locations.join(", ") : "unknown device";
}

const DETECTED_TITLE = {
  Fire: "Fire detected",
  Trouble: "Trouble detected",
  Supervisory: "Supervisory alarm detected",
};

/**
 * AutoPilot runner (no UI apart from its notice stack). When enabled, every new fire / trouble /
 * supervisory message is handled automatically: acknowledge (closing its modal
 * and opening its live page) → wait for the ack in the panel logs → silence →
 * system reset → (fire, optional) disable the fire device after 1.5s.
 * Settings and progress live in useAutoPilotStore; page: /dashboard/autopilot.
 */
export function AutoPilotController() {
  const router = useRouter();
  const { autoAcknowledgeFire, clearTroubleAckPending, clearSupervisoryAckPending } =
    useFireAlert();
  const { autoAcknowledgeAlert } = useLivePanelAlert();
  const { silenceAlarm, systemReset, disableDevice } = useApp();

  // Latest callbacks for the long-lived listener below.
  const apiRef = useRef(null);
  useEffect(() => {
    apiRef.current = {
      router,
      autoAcknowledgeFire,
      clearTroubleAckPending,
      clearSupervisoryAckPending,
      autoAcknowledgeAlert,
      silenceAlarm,
      systemReset,
      disableDevice,
    };
  });

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    /** label → incidents waiting for a run: { label, entry, location, receivedAt } */
    const pending = { Fire: [], Trouble: [], Supervisory: [] };
    /** Acknowledgement lines seen in the panel logs. */
    let ackLog = [];
    let running = null;
    let disposed = false;

    const store = () => useAutoPilotStore.getState();

    const publishQueue = () => {
      store().setQueue(
        Object.keys(PRIORITY)
          .filter((label) => pending[label].length > 0)
          .map((label) => ({
            label,
            count: pending[label].length,
            since: pending[label][0].receivedAt,
          })),
      );
    };

    const checkStopped = (run) => {
      if (disposed || run.stopReason) throw new RunStopped(run.stopReason || "disposed");
    };

    const pause = async (run, ms) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        checkStopped(run);
        await sleep(Math.min(POLL_MS, end - Date.now()));
      }
      checkStopped(run);
    };

    /**
     * "... ACKED AT NODE n" lines logged since this run's `ack` that belong to
     * its category or locations ("NORMAL ACKED" restores do not count).
     */
    const countConfirmations = (run) => {
      if (!run.ackSentAt) return 0;
      const matches = ackLog.filter(
        (ack) =>
          ack.atNode &&
          ack.receivedAt >= run.ackSentAt &&
          (ack.label === run.label || (ack.location && run.locations.has(ack.location))),
      ).length;
      return Math.min(matches, run.incidents.length);
    };

    const sendAck = async (label) => {
      const api = apiRef.current;
      if (!api) return false;
      store().markAcknowledged(label);
      if (label === "Fire") {
        return api.autoAcknowledgeFire({ timeoutMs: ACK_COMMAND_TIMEOUT_MS });
      }
      if (label === "Trouble") api.clearTroubleAckPending?.();
      else api.clearSupervisoryAckPending?.();
      const route = LIVE_PANEL_ROUTE_BY_LABEL[label];
      if (route) api.router.push(route);
      return api.autoAcknowledgeAlert(label, { timeoutMs: ACK_COMMAND_TIMEOUT_MS });
    };

    const executeRun = async (run) => {
      const t0 = run.incidents[0].receivedAt;
      const elapsed = () => Date.now() - t0;
      const step = (id, patch) => store().updateStep(run.id, id, patch);
      const wantsDisable = run.label === "Fire" && store().disableFireDevice;
      const tone = run.label.toLowerCase();
      const notify = (notice) => store().pushNotice({ tone, ...notice });

      store().startRun({
        id: run.id,
        label: run.label,
        count: run.incidents.length,
        locations: [...new Set(run.incidents.map((i) => i.location).filter(Boolean))],
        startedAt: t0,
        includesDisable: wantsDisable,
        steps: {},
      });

      if (!useFirePanelStore.getState().connected) {
        store().finishRun(run.id, { outcome: "skipped", message: "Fire panel not connected." });
        return;
      }

      // Announce the alarm as soon as its device(s) are known.
      void resolveDeviceAddresses(run.incidents, run.label)
        .catch(() => [])
        .then((addresses) => {
          notify({
            title: DETECTED_TITLE[run.label] || `${run.label} detected`,
            description: `On device/s: ${describeDevices(addresses, run)}`,
          });
        });

      // 1. Acknowledge 2s after the message arrived.
      step("ack", { status: "waiting" });
      await pause(run, Math.max(0, t0 + ACK_START_DELAY_MS - Date.now()));
      // Pick the fire device now, before the reset clears the F flags.
      const runAddresses = resolveDeviceAddresses(run.incidents, run.label).catch(() => []);
      const disableTargets = wantsDisable ? runAddresses : Promise.resolve([]);

      step("ack", { status: "running" });
      run.ackSentAt = Date.now();
      const ackOk = await sendAck(run.label);
      step("ack", {
        status: ackOk ? "done" : "warning",
        at: elapsed(),
        message: ackOk ? "Sent" : "The panel did not answer",
      });
      const ackedDevices = describeDevices(await runAddresses, run);
      notify(
        ackOk
          ? { title: "Acknowledged", description: `Device/s: ${ackedDevices}` }
          : {
              tone: "error",
              title: "Acknowledge not confirmed",
              description: `The panel did not answer — device/s: ${ackedDevices}`,
            },
      );
      checkStopped(run);

      // 2. Watch the panel logs up to 2s for the button-ack line
      //    ("... ACKED AT NODE n"); move on to Silence either way.
      step("confirm", { status: "running", message: "Waiting for the panel" });
      // A fire ack is already confirmed by acknowledgeFireConfirmed (ACKED line
      // or `list f` no longer showing FIRE*) — no extra wait.
      const ackLogWaitEnd = run.label === "Fire" && ackOk ? Date.now() : Date.now() + ACK_LOG_WAIT_MS;
      let confirmed = run.label === "Fire" && ackOk ? run.incidents.length : countConfirmations(run);
      while (confirmed < run.incidents.length && Date.now() < ackLogWaitEnd) {
        await pause(run, POLL_MS);
        confirmed = countConfirmations(run);
      }
      run.ackConfirmed = true;
      step("confirm", {
        status: confirmed === 0 || confirmed < run.incidents.length ? "warning" : "done",
        at: elapsed(),
        message:
          confirmed === 0
            ? "No reply from the panel — carrying on"
            : confirmed < run.incidents.length
              ? `${confirmed} of ${run.incidents.length} confirmed — carrying on`
              : "Confirmed",
      });

      const api = apiRef.current;
      const budgetEnd = t0 + AUTOPILOT_BUDGET_MS;

      /**
       * Pause before the next command: the desired human gap, shrunk evenly
       * toward each remaining pause's minimum when the budget is tight.
       */
      const pacedPause = async (key) => {
        const remaining = PACING_ORDER.slice(PACING_ORDER.indexOf(key));
        const desiredSum = remaining.reduce((sum, k) => sum + PACING[k].desired, 0);
        const minSum = remaining.reduce((sum, k) => sum + PACING[k].min, 0);
        const available = budgetEnd - Date.now() - COMMANDS_AFTER_PAUSE[key] * COMMAND_RESERVE_MS;
        const { desired, min } = PACING[key];
        let ms = desired;
        if (available <= minSum) ms = min;
        else if (available < desiredSum) {
          ms = min + ((desired - min) * (available - minSum)) / (desiredSum - minSum);
        }
        await pause(run, Math.round(ms));
      };

      /** Log in (retried until ACCESS GRANTED, ~12s from the first try). */
      const loginAndWaitForGrant = async (stepId) => {
        if (!useFirePanelStore.getState().connected) {
          return { granted: false, attempts: 0, reason: "panel disconnected" };
        }
        return loginToPanel({
          shouldStop: () => disposed || Boolean(run.stopReason),
          onAttempt: (attempt) =>
            step(stepId, {
              status: "running",
              message: `Logging in to the panel${attempt > 1 ? ` (try ${attempt})` : ""}`,
            }),
          onRetry: (attempt, reason) =>
            step(stepId, {
              status: "warning",
              message: `Login didn't work (${reason}) — trying again`,
            }),
        });
      };

      /** Send one navbar action's set commands on the current login. */
      const sendPanelAction = async (stepId, send) => {
        try {
          await send();
        } catch (error) {
          console.error(`[AutoPilot] ${stepId} failed:`, error);
          step(stepId, { status: "failed", at: elapsed(), message: "The panel did not accept it" });
          return false;
        }
        step(stepId, { status: "done", at: elapsed(), message: "" });
        return true;
      };

      // 3. Log in once — Silence and Reset both use this login.
      step("silence", { status: "waiting" });
      await pacedPause("afterAck");
      useHeaderActionProgressStore.getState().start("silence");
      const login = await loginAndWaitForGrant("silence");

      let silenceOk = false;
      let resetOk = false;
      if (!login.granted) {
        step("silence", { status: "failed", at: elapsed(), message: `Couldn't log in (${login.reason})` });
        step("reset", { status: "failed", at: elapsed(), message: "Skipped — couldn't log in" });
        notify({ tone: "error", title: "Silence alarm failed", description: "Couldn't log in to the panel" });
      } else {
        step("silence", { status: "running", message: "Logged in — silencing" });

        // Silence Alarm.
        await pacedPause("silenceSettle");
        silenceOk = await sendPanelAction("silence", () => api.silenceAlarm({ login: false }));
        notify(
          silenceOk
            ? { tone: "success", title: "Silence alarm successful" }
            : { tone: "error", title: "Silence alarm failed", description: run.label },
        );
        checkStopped(run);

        // 4. System Reset on the same login.
        step("reset", { status: "waiting", message: "" });
        await pacedPause("betweenActions");
        useHeaderActionProgressStore.getState().start("reset");
        step("reset", { status: "running", message: "Resetting" });
        resetOk = await sendPanelAction("reset", () => api.systemReset({ login: false }));
      }
      const totalMs = elapsed();
      if (login.granted) {
        notify(
          resetOk
            ? { tone: "success", title: "System reset successful" }
            : { tone: "error", title: "System reset failed", description: run.label },
        );
      }

      // 5. Optional: disable the fire device, 1.5s after the reset.
      if (wantsDisable) {
        step("disable", { status: "waiting" });
        await pause(run, POST_RESET_WAIT_MS);
        const addresses = await disableTargets;
        if (addresses.length === 0) {
          step("disable", {
            status: "warning",
            at: elapsed(),
            message: "Couldn't tell which device it was — left on",
          });
          notify({
            tone: "error",
            title: "Fire device not turned off",
            description: `Couldn't tell which device it was: ${describeDevices([], run)}`,
          });
        } else {
          step("disable", { status: "running", message: addresses.join(", ") });
          const failed = [];
          for (const address of addresses) {
            try {
              await api.disableDevice(address);
            } catch (error) {
              failed.push(address);
              console.error(`[AutoPilot] disable ${address} failed:`, error);
            }
          }
          step("disable", {
            status: failed.length ? "failed" : "done",
            at: elapsed(),
            message: failed.length
              ? `Couldn't turn off ${failed.join(", ")}`
              : `Turned off ${addresses.join(", ")}`,
          });
          const disabled = addresses.filter((address) => !failed.includes(address));
          if (disabled.length > 0) {
            notify({ title: "Device turned off", description: `Device/s: ${disabled.join(", ")}` });
          }
          if (failed.length > 0) {
            notify({
              tone: "error",
              title: "Couldn't turn off device",
              description: `Device/s: ${failed.join(", ")}`,
            });
          }
        }
      }

      store().finishRun(run.id, {
        outcome: silenceOk && resetOk ? "completed" : "completed-with-errors",
        totalMs,
        withinBudget: totalMs <= AUTOPILOT_BUDGET_MS,
      });
    };

    const pump = async () => {
      if (running || disposed) return;
      const label = Object.keys(PRIORITY).find((key) => pending[key].length > 0);
      if (!label) return;

      const incidents = pending[label];
      pending[label] = [];
      publishQueue();

      const run = {
        id: `${label}-${incidents[0].receivedAt}-${Date.now()}`,
        label,
        incidents,
        locations: new Set(incidents.map((i) => normalizeLocation(i.location)).filter(Boolean)),
        ackSentAt: 0,
        ackConfirmed: false,
        stopReason: null,
      };
      running = run;
      // Keep list re-syncs off the panel for the whole run.
      store().setHoldListDumps(true);

      try {
        await executeRun(run);
      } catch (error) {
        if (!(error instanceof RunStopped)) {
          console.error("[AutoPilot] run failed:", error);
          store().finishRun(run.id, { outcome: "failed", message: "Something went wrong." });
        } else if (run.stopReason === "preempted") {
          if (run.ackConfirmed) {
            // Already acknowledged — the fire run's silence + reset covers it.
            store().finishRun(run.id, { outcome: "superseded", message: "A fire alarm came in first." });
          } else {
            pending[label] = [...run.incidents, ...pending[label]];
            store().finishRun(run.id, {
              outcome: "preempted",
              message: "Paused for a fire alarm — will finish after.",
            });
          }
        } else if (run.stopReason === "disabled") {
          store().finishRun(run.id, { outcome: "cancelled", message: "AutoPilot was turned off." });
        }
      } finally {
        running = null;
        store().setHoldListDumps(false);
        publishQueue();
        if (!disposed) void pump();
      }
    };

    const handleEntry = (event) => {
      const { type, label, entry, receivedAt } = event?.detail || {};
      if (!type || !label || !entry) return;
      const at = Number(receivedAt) || Date.now();

      if (type === "ack") {
        ackLog.push({
          label,
          location: normalizeLocation(entry.location),
          atNode: ACK_AT_NODE_RE.test(`${entry.status || ""} ${entry.raw || ""}`),
          receivedAt: at,
        });
        ackLog = ackLog.filter((ack) => at - ack.receivedAt < 60000).slice(-100);
        return;
      }

      if (!store().enabled) return;
      const incident = { label, entry, location: entry.location || "", receivedAt: at };

      if (running && running.label === label && !running.ackSentAt) {
        // Not acknowledged yet — the coming ack covers this message too.
        running.incidents.push(incident);
        const location = normalizeLocation(incident.location);
        if (location) running.locations.add(location);
        return;
      }

      pending[label].push(incident);
      publishQueue();
      if (running && PRIORITY[label] < PRIORITY[running.label] && !running.stopReason) {
        running.stopReason = "preempted";
      }
      void pump();
    };

    // Turning AutoPilot off cancels the current run and drops the queue.
    const unsubscribe = useAutoPilotStore.subscribe((state, prev) => {
      if (prev.enabled && !state.enabled) {
        pending.Fire = [];
        pending.Trouble = [];
        pending.Supervisory = [];
        publishQueue();
        if (running && !running.stopReason) running.stopReason = "disabled";
      }
    });

    window.addEventListener("vision365:livePanelEntry", handleEntry);
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("vision365:livePanelEntry", handleEntry);
    };
  }, []);

  return <AutoPilotNotices />;
}
