import { getDocument } from "@/lib/serverDb";

/** Sum alarmDetails totals across every *BuildingDB (all buildings / communities). */
export function sumAlarmDetailsFromDb(db) {
  let totalFire = 0;
  let totalTrouble = 0;
  let totalSupervisory = 0;
  let panelStatus = false;
  let lastPanelSync = null;
  let buildingCount = 0;

  for (const key of Object.keys(db)) {
    if (!key.endsWith("BuildingDB")) continue;
    const alarmDetails = getDocument(db, [key, "alarmDetails"]);
    if (!alarmDetails || typeof alarmDetails !== "object") continue;

    buildingCount++;
    totalFire += Number(alarmDetails.totalFire) || 0;
    totalTrouble += Number(alarmDetails.totalTrouble) || 0;
    totalSupervisory += Number(alarmDetails.totalSupervisory) || 0;
    if (alarmDetails.panelStatus === true) panelStatus = true;

    const sync = alarmDetails.lastPanelSync;
    if (typeof sync === "string" && (!lastPanelSync || sync > lastPanelSync)) {
      lastPanelSync = sync;
    }
  }

  return {
    totalFire,
    totalTrouble,
    totalSupervisory,
    panelStatus,
    lastPanelSync,
    buildingCount,
  };
}
