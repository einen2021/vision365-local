import { isDesktop, resolvePublicAssetUrl } from "@/lib/platform";

const ALARM_SOUND_URL = "/alarm_sound.mp3";

/**
 * Looping fire-alarm siren.
 *
 * On desktop this plays natively via the Tauri backend (rodio/cpal) instead
 * of an HTML5 <audio> element, so it isn't subject to the webview's autoplay
 * policy or per-tab mute state — the fire panel's Ack/Silence workflow and
 * the in-app Mute Siren button are the only things that can stop it (besides
 * the OS's own master volume/mute, which nothing running in software can
 * override). Falls back to an HTML5 Audio element on web.
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

  const audio = new Audio(resolvePublicAssetUrl(ALARM_SOUND_URL));
  audio.loop = true;
  audio.preload = "auto";

  // Webviews block unmuted autoplay outside a user gesture. Starting muted
  // is always allowed; unmuting right after playback begins keeps the siren
  // going without needing a fresh gesture.
  audio.muted = true;
  const unmute = () => {
    audio.muted = false;
  };
  const playPromise = audio.play();
  if (playPromise) {
    playPromise.then(unmute).catch((err) => {
      console.error("[fireAlertSiren] audio.play() failed:", err);
    });
  } else {
    unmute();
  }

  return () => {
    audio.pause();
    audio.currentTime = 0;
  };
}
