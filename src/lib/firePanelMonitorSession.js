/** Persists monitor intent across reloads; loop flag survives React remounts. */

const STORAGE_KEY = "vision365.firePanelMonitoring";

let monitorLoopActive = false;
let monitorLoopPaused = false;

export function isFirePanelMonitoringPersisted() {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === "1";
}

export function setFirePanelMonitoringPersisted(active) {
  if (typeof window === "undefined") return;
  if (active) sessionStorage.setItem(STORAGE_KEY, "1");
  else sessionStorage.removeItem(STORAGE_KEY);
}

export function isMonitorLoopActive() {
  return monitorLoopActive;
}

export function isMonitorLoopPaused() {
  return monitorLoopPaused;
}

export function pauseMonitorLoop() {
  monitorLoopPaused = true;
}

export function resumeMonitorLoop() {
  monitorLoopPaused = false;
}

export function setMonitorLoopActive(active) {
  monitorLoopActive = Boolean(active);
  if (!active) monitorLoopPaused = false;
}
