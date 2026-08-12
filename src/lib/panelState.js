/**
 * Legacy panel helpers — prefer desktop-server firePanelAlarmSync for persistence.
 * These only operate on an in-memory db object (no Mongo / SQLite connection).
 */

import { getDocument, setDocument } from "@/lib/serverDb";

/** Read root firePanelState document (panel CVAL totals, not BuildingDB). */
export function getStoredPanelStateFromDb(db) {
  const doc = getDocument(db, ["firePanelState"]);
  return {
    totalFire: Number(doc?.totalFire) || 0,
    totalTrouble: Number(doc?.totalTrouble) || 0,
    totalSupervisory: Number(doc?.totalSupervisory) || 0,
    lastPanelSync:
      typeof doc?.lastPanelSync === "string" ? doc.lastPanelSync : null,
  };
}

/** Apply panel totals onto an in-memory db object (caller persists). */
export function applyPanelStateCounts(db, counts) {
  const next = {
    totalFire: Number(counts.totalFire) || 0,
    totalTrouble: Number(counts.totalTrouble) || 0,
    totalSupervisory: Number(counts.totalSupervisory) || 0,
  };

  const existing = getStoredPanelStateFromDb(db);
  if (
    existing.totalFire === next.totalFire &&
    existing.totalTrouble === next.totalTrouble &&
    existing.totalSupervisory === next.totalSupervisory
  ) {
    return { changed: false, ...existing };
  }

  const payload = {
    ...next,
    lastPanelSync: new Date().toISOString(),
  };
  setDocument(db, ["firePanelState"], payload, false);
  return { changed: true, ...payload };
}
