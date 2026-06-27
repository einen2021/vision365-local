import { getDocument, mutateDb, setDocument } from "@/lib/serverDb";

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

/** Write all three CVAL totals to firePanelState when any value changed. */
export async function savePanelStateCounts(counts) {
  const next = {
    totalFire: Number(counts.totalFire) || 0,
    totalTrouble: Number(counts.totalTrouble) || 0,
    totalSupervisory: Number(counts.totalSupervisory) || 0,
  };

  let result;

  await mutateDb((db) => {
    const existing = getStoredPanelStateFromDb(db);

    if (
      existing.totalFire === next.totalFire &&
      existing.totalTrouble === next.totalTrouble &&
      existing.totalSupervisory === next.totalSupervisory
    ) {
      result = { ...existing, unchanged: true };
      return;
    }

    const now = new Date().toISOString();
    const payload = { ...next, lastPanelSync: now };
    const doc = getDocument(db, ["firePanelState"]) || {};
    setDocument(
      db,
      ["firePanelState"],
      {
        ...doc,
        ...payload,
      },
      true,
    );
    result = payload;
  });

  return result;
}
