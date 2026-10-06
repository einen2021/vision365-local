import { isDesktop, resolvePublicAssetUrl } from "@/lib/platform";

const ALARM_SOUND_URL = "/alarm_sound.mp3";

/**
 * Creates and starts Web Audio synthesized fire alarm backup siren.
 * Plays a classic emergency sweeping tone (700Hz to 1100Hz).
 */
function createSyntheticFireSiren() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(750, ctx.currentTime);

    // Continuous sweep
    const now = ctx.currentTime;
    for (let i = 0; i < 200; i++) {
      const t = now + i * 0.6;
      osc.frequency.setValueAtTime(700, t);
      osc.frequency.linearRampToValueAtTime(1150, t + 0.3);
      osc.frequency.linearRampToValueAtTime(700, t + 0.6);
    }

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();

    return () => {
      try {
        gain.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.05);
        setTimeout(() => {
          try {
            osc.stop();
            osc.disconnect();
            ctx.close().catch(() => {});
          } catch {
            // ignore
          }
        }, 60);
      } catch {
        // ignore
      }
    };
  } catch (e) {
    console.warn("[fireAlertSiren] Web Audio siren fallback not available:", e);
    return null;
  }
}

/**
 * Looping fire-alarm siren.
 *
 * Plays audio file at full volume with synthetic Web Audio backup so the siren
 * is guaranteed to be audible.
 */
export function startFireAlertSiren() {
  if (typeof window === "undefined") return () => {};

  if (isDesktop()) {
    let stopped = false;
    void import("@tauri-apps/api/core")
      .then(({ invoke }) => {
        if (stopped) return;
        return invoke("start_fire_siren");
      })
      .catch((err) => {
        console.error("[fireAlertSiren] start_fire_siren failed:", err);
      });

    return () => {
      stopped = true;
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("stop_fire_siren"))
        .catch((err) => {
          console.error("[fireAlertSiren] stop_fire_siren failed:", err);
        });
    };
  }

  let stopped = false;
  let audio = null;
  let stopSynth = null;

  try {
    audio = new Audio(resolvePublicAssetUrl(ALARM_SOUND_URL));
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = 1;
    audio.muted = false;

    const playPromise = audio.play();
    if (playPromise) {
      playPromise.catch((err) => {
        console.warn("[fireAlertSiren] HTML5 Audio autoplay blocked or failed, activating synthesizer:", err);
        if (!stopped && !stopSynth) {
          stopSynth = createSyntheticFireSiren();
        }

        const onGesture = () => {
          if (!stopped && audio) {
            audio.play().catch(() => {});
          }
        };
        window.addEventListener("click", onGesture, { once: true });
        window.addEventListener("keydown", onGesture, { once: true });
        window.addEventListener("pointerdown", onGesture, { once: true });
      });
    }
  } catch (err) {
    console.error("[fireAlertSiren] Audio init error:", err);
    if (!stopSynth) {
      stopSynth = createSyntheticFireSiren();
    }
  }

  return () => {
    stopped = true;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    if (stopSynth) {
      stopSynth();
      stopSynth = null;
    }
  };
}
