import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { normalizeBuildingName } from "@/lib/buildingNames";

function buildingDbId(buildingName) {
  const base = normalizeBuildingName(buildingName);
  if (!base) return "";
  return `${base}BuildingDB`;
}

/** Human-readable local time for alarm feed rows. */
export function formatAlarmFeedTime(ms = Date.now()) {
  try {
    const n = typeof ms === "number" ? ms : Date.parse(String(ms));
    if (!Number.isFinite(n)) return "—";
    return new Date(n).toLocaleString();
  } catch {
    return "—";
  }
}

function toTimestamp(time) {
  if (typeof time === "number" && Number.isFinite(time)) return time;
  if (typeof time === "string") {
    const parsed = Date.parse(time);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

/**
 * Build a feed row with numeric time (for sorting/UI) and readable time in the message.
 * Example message: "Fire at Device X — 7/12/2026, 9:39:12 AM"
 */
function alarmRow(message, time = Date.now()) {
  const ts = toTimestamp(time);
  const formatted = formatAlarmFeedTime(ts);
  const base = String(message || "").trim() || "Alarm";
  return {
    message: `${base} — ${formatted}`,
    time: ts,
  };
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
  time = Date.now(),
}) {
  const buildingDb = buildingDbId(building);
  if (!buildingDb) return false;

  const detail = String(description || "Unknown device").trim() || "Unknown device";
  const ts = toTimestamp(time);

  if (label === "Fire") {
    await appendArrayField(
      buildingDb,
      "alarmMessages",
      "alarmMessages",
      alarmRow(`Fire alarm at ${detail}`, ts),
    );
    await appendArrayField(
      buildingDb,
      "liveFire",
      "liveFire",
      alarmRow(`Fire at ${detail}`, ts),
    );
    return true;
  }

  if (label === "Trouble") {
    await appendArrayField(
      buildingDb,
      "liveTrouble",
      "liveTrouble",
      alarmRow(`Trouble at ${detail}`, ts),
    );
    return true;
  }

  if (label === "Supervisory") {
    await appendArrayField(
      buildingDb,
      "liveSupervisory",
      "liveSupervisory",
      alarmRow(`Supervisory at ${detail}`, ts),
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
