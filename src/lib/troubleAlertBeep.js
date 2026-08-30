/** Repeating panel alert sound for trouble / supervisory increases. */

import { isDesktop, resolvePublicAssetUrl } from "@/lib/platform";

const BEEP_INTERVAL_MS = 2800;
const BEEP_SRC = "/beep.mp3";

let loopTimer = null;
const silenced = { Trouble: false, Supervisory: false };
const activeBeeps = new Set();

function createPanelAlertAudio() {
  if (typeof window === "undefined") return null;

  const audio = new Audio(resolvePublicAssetUrl(BEEP_SRC));
  audio.preload = "auto";
  audio.volume = 1;
  return audio;
}

/**
 * Play the custom panel alert sound once.
 *
 * On desktop this plays natively via the Tauri backend (rodio/cpal) instead
 * of an HTML5 <audio> element, so it isn't subject to the webview's autoplay
 * policy. Falls back to an HTML5 Audio element on web.
 */
export function playPanelAlertBeep() {
  if (isDesktop()) {
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => invoke("play_panel_alert_beep"))
      .catch((err) => {
        console.error("[troubleAlertBeep] play_panel_alert_beep failed:", err);
      });
    return;
  }

  const audio = createPanelAlertAudio();
  if (!audio) return;

  // Webviews block unmuted autoplay outside a user gesture. Starting muted
  // is always allowed; unmuting right after playback begins keeps the beep
  // audible without needing a fresh gesture.
  audio.muted = true;
  void audio
    .play()
    .then(() => {
      audio.muted = false;
    })
    .catch((err) => {
      console.error("[troubleAlertBeep] audio.play() failed:", err);
    });
}

/** @deprecated Use playPanelAlertBeep */
export const playTroubleDoubleBeep = playPanelAlertBeep;

function shouldPlayBeep() {
  return [...activeBeeps].some((label) => !silenced[label]);
}

function refreshBeepLoop() {
  if (!shouldPlayBeep()) {
    if (loopTimer) {
      clearInterval(loopTimer);
      loopTimer = null;
    }
    return;
  }

  if (loopTimer) return;

  playPanelAlertBeep();
  loopTimer = setInterval(playPanelAlertBeep, BEEP_INTERVAL_MS);
}

function startPanelAlertBeep(label) {
  if (typeof window === "undefined") return;
  activeBeeps.add(label);
  refreshBeepLoop();
}

function stopPanelAlertBeep(label) {
  activeBeeps.delete(label);
  refreshBeepLoop();
}

function silencePanelAlertBeep(label) {
  silenced[label] = true;
  refreshBeepLoop();
}

function resetPanelAlertSilence(label) {
  silenced[label] = false;
}

export function startTroubleAlertBeep() {
  startPanelAlertBeep("Trouble");
}

export function startSupervisoryAlertBeep() {
  startPanelAlertBeep("Supervisory");
}

export function stopTroubleAlertBeep() {
  stopPanelAlertBeep("Trouble");
}

export function stopSupervisoryAlertBeep() {
  stopPanelAlertBeep("Supervisory");
}

export function silenceTroubleAlertBeep() {
  silencePanelAlertBeep("Trouble");
}

export function silenceSupervisoryAlertBeep() {
  silencePanelAlertBeep("Supervisory");
}

export function resetTroubleAlertSilence() {
  resetPanelAlertSilence("Trouble");
}

export function resetSupervisoryAlertSilence() {
  resetPanelAlertSilence("Supervisory");
}

export function isTroubleAlertSilenced() {
  return silenced.Trouble;
}

export function isSupervisoryAlertSilenced() {
  return silenced.Supervisory;
}
