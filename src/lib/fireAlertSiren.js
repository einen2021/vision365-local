const ALARM_SOUND_URL = "/alarm_sound.mp3";

/** Looping fire-alarm siren from alarm_sound.mp3. */
export function startFireAlertSiren() {
  if (typeof window === "undefined") return () => {};

  const audio = new Audio(ALARM_SOUND_URL);
  audio.loop = true;
  audio.preload = "auto";

  const playPromise = audio.play();
  if (playPromise) {
    playPromise.catch(() => {
      // Browser may block autoplay until user interaction
    });
  }

  return () => {
    audio.pause();
    audio.currentTime = 0;
  };
}
