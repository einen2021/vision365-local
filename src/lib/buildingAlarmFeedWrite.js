import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { normalizeBuildingName } from "@/lib/buildingNames";

function buildingDbId(buildingName) {
  const base = normalizeBuildingName(buildingName);
  if (!base) return "";
  return `${base}BuildingDB`;
}

function alarmRow(message, time) {
  return { message, time };
}

async function appendArrayField(buildingDb, docId, fieldKey, row) {
  const ref = doc(db, buildingDb, docId);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    const existing = snap.data()?.[fieldKey];
    await updateDoc(ref, {
      [fieldKey]: [...(Array.isArray(existing) ? existing : []), row],
    });
    return;
  }

  await setDoc(ref, { [fieldKey]: [row] });
}

/** Append alarm archive + live feed rows for a building when panel CVAL increases. */
export async function appendBuildingAlarmFeed({
  building,
  label,
  description,
  time = new Date().toISOString(),
}) {
  const buildingDb = buildingDbId(building);
  if (!buildingDb) return false;

  const detail = String(description || "Unknown device").trim() || "Unknown device";

  if (label === "Fire") {
    await appendArrayField(
      buildingDb,
      "alarmMessages",
      "alarmMessages",
      alarmRow(`Fire alarm at ${detail}`, time),
    );
    await appendArrayField(
      buildingDb,
      "liveFire",
      "liveFire",
      alarmRow(`Fire at ${detail}`, time),
    );
    return true;
  }

  if (label === "Trouble") {
    await appendArrayField(
      buildingDb,
      "liveTrouble",
      "liveTrouble",
      alarmRow(`Trouble at ${detail}`, time),
    );
    return true;
  }

  if (label === "Supervisory") {
    await appendArrayField(
      buildingDb,
      "liveSupervisory",
      "liveSupervisory",
      alarmRow(`Supervisory at ${detail}`, time),
    );
    return true;
  }

  return false;
}

/** Resolve building name from an AssetsList document (supports legacy typo). */
export function resolveBuildingFromAsset(asset, fallbackBuildings = []) {
  const fromAsset = normalizeBuildingName(
    asset?.building || asset?.buildingName || asset?.builing,
  );
  if (fromAsset) return fromAsset;

  const fallbacks = (fallbackBuildings || [])
    .map((name) => normalizeBuildingName(name))
    .filter(Boolean);

  if (fallbacks.length === 1) return fallbacks[0];
  return "";
}
