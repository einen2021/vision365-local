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

/**
 * Parse `show counts` output from the fire panel.
 * Example input:
 * - show counts
 * FIRE = 0           PRIORITY2 = 0      SUPERVISORY = 0    TROUBLE = 217
 * -
 * -
 */
export function parseShowCountsResponse(text = "") {
  const clean = String(text || "");
  const fireMatch = /FIRE\s*=\s*(\d+)/i.exec(clean);
  const supervisoryMatch = /SUPERVISORY\s*=\s*(\d+)/i.exec(clean);
  // TROUBLE ends the line — require the line end so a reply cut mid-number
  // ("TROUBLE = 2" of 217) is rejected instead of read as 2.
  const troubleMatch = /TROUBLE\s*=\s*(\d+)[ \t]*[\r\n]/i.exec(clean);
  const priority2Match = /PRIORITY2\s*=\s*(\d+)/i.exec(clean);

  // All three totals must be present. A cut-off reply ("FIRE = 0  PRIORITY2 =")
  // must not be read as TROUBLE = 0 — that wipes the whole trouble list.
  if (!fireMatch || !supervisoryMatch || !troubleMatch) {
    return null;
  }

  return {
    totalFire: fireMatch ? Number(fireMatch[1]) : 0,
    totalSupervisory: supervisoryMatch ? Number(supervisoryMatch[1]) : 0,
    totalTrouble: troubleMatch ? Number(troubleMatch[1]) : 0,
    priority2: priority2Match ? Number(priority2Match[1]) : 0,
  };
}

