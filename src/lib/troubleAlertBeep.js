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

function createSyntheticPanelBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const playTone = (time, freq, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, time);
      gain.gain.setValueAtTime(0.25, time);
      gain.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(time);
      osc.stop(time + dur);
    };

    const now = ctx.currentTime;
    playTone(now, 1100, 0.12);
    playTone(now + 0.15, 1100, 0.12);

    setTimeout(() => {
      ctx.close().catch(() => {});
    }, 450);
  } catch {
    // ignore
  }
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
  if (!audio) {
    createSyntheticPanelBeep();
    return;
  }

  audio.muted = false;
  audio.volume = 1;
  const playPromise = audio.play();
  if (playPromise) {
    playPromise.catch((err) => {
      console.warn("[troubleAlertBeep] audio.play() blocked, using synthetic tone:", err);
      createSyntheticPanelBeep();
    });
  }
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
  silenced[label] = false;

  // Clear existing timer to immediately play fresh beep
  if (loopTimer) {
    clearInterval(loopTimer);
    loopTimer = null;
  }

  playPanelAlertBeep();
  loopTimer = setInterval(playPanelAlertBeep, BEEP_INTERVAL_MS);
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
  refreshBeepLoop();
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
