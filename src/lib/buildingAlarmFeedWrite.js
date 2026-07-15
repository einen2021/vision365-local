import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { findNewPanelListEntries } from "@/lib/livePanelListHighlight";

function buildingDbId(buildingName) {
  const base = normalizeBuildingName(buildingName);
  if (!base) return "";
  return `${base}BuildingDB`;
}

/** Map panel list label → live feed doc id / field name. */
const LIVE_FEED_BY_LABEL = {
  Fire: { docId: "liveFire", fieldKey: "liveFire" },
  Trouble: { docId: "liveTrouble", fieldKey: "liveTrouble" },
  Supervisory: { docId: "liveSupervisory", fieldKey: "liveSupervisory" },
};

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
 * Build a feed row with numeric time (for sorting/UI).
 * Time is stored separately — the history page shows it in its own column.
 * Example: { message: "Fire at Device X", time: 1700000000000 }
 */
function alarmRow(message, time = Date.now()) {
  const ts = toTimestamp(time);
  const base = String(message || "").trim() || "Alarm";
  return {
    message: base,
    time: ts,
    timestamp: new Date(ts).toISOString(),
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

/**
 * Append alarm archive + live feed rows for a building when panel CVAL increases.
 * Prefer `message` (already-formatted panel text). Fall back to description.
 */
export async function appendBuildingAlarmFeed({
  building,
  label,
  description,
  message = null,
  time = Date.now(),
  // When panel-list lines were already written to live{field}, skip the short summary row.
  skipLiveField = false,
}) {
  const buildingDb = buildingDbId(building);
  if (!buildingDb) return false;

  const detail = String(description || "Unknown device").trim() || "Unknown device";
  const ts = toTimestamp(time);
  const formatted = String(message || "").trim();

  if (label === "Fire") {
    await appendArrayField(
      buildingDb,
      "alarmMessages",
      "alarmMessages",
      alarmRow(formatted || `Fire alarm at ${detail}`, ts),
    );
    if (!skipLiveField) {
      await appendArrayField(
        buildingDb,
        "liveFire",
        "liveFire",
        alarmRow(formatted || `Fire at ${detail}`, ts),
      );
    }
    return true;
  }

  if (label === "Trouble") {
    if (!skipLiveField) {
      await appendArrayField(
        buildingDb,
        "liveTrouble",
        "liveTrouble",
        alarmRow(formatted || `Trouble at ${detail}`, ts),
      );
    }
    return true;
  }

  if (label === "Supervisory") {
    if (!skipLiveField) {
      await appendArrayField(
        buildingDb,
        "liveSupervisory",
        "liveSupervisory",
        alarmRow(formatted || `Supervisory at ${detail}`, ts),
      );
    }
    return true;
  }

  return false;
}

/** Resolve building name from an AssetsList document (supports legacy typo). */
export function resolveBuildingFromAsset(
  asset,
  fallbackBuildings = [],
  preferredBuilding = "",
) {
  const fromAsset = normalizeBuildingName(
    asset?.building || asset?.buildingName || asset?.builing,
  );
  if (fromAsset) return fromAsset;

  // Prefer the user's currently selected building when the asset lookup misses.
  const preferred = normalizeBuildingName(preferredBuilding);
  if (preferred) return preferred;

  const fallbacks = (fallbackBuildings || [])
    .map((name) => normalizeBuildingName(name))
    .filter(Boolean);

  // Always pick a building when asset lookup misses.
  if (fallbacks.length > 0) return fallbacks[0];
  return "";
}

/**
 * Turn a panel list line into a feed/history row.
 * Always uses the current timestamp (when we detected this line as new).
 * message = exact panel line (history pages compare against this).
 */
function listLineToFeedRow(entry, fetchedAtMs = Date.now()) {
  const raw = String(entry?.raw || entry?.rawMessage || "").trim();
  const time = toTimestamp(fetchedAtMs);
  return {
    message: raw || "Alarm",
    time,
    timestamp: new Date(time).toISOString(),
    rawMessage: raw || null,
  };
}

/**
 * Compare the new list f/t/s response with the previously saved one, then
 * append only NEW lines (with the current timestamp) to:
 *   - liveFire / liveTrouble / liveSupervisory  (history tabs read these)
 *   - alarmMessages for Fire                    (Alarm messages tab)
 *
 * Also stores listResponse so the next list run can diff against it.
 * Does not wipe existing history when the active list shrinks or clears.
 */
export async function syncNewListLinesToBuildingFeed({
  building,
  label,
  listCmd = "",
  response = "",
  // Optional in-memory previous text; Firestore listResponse is the fallback.
  previousResponse = null,
  fetchedAt = Date.now(),
}) {
  const target = LIVE_FEED_BY_LABEL[label];
  const buildingDb = buildingDbId(building);
  if (!target || !buildingDb) return { saved: false, added: 0 };

  const fetchedAtMs = toTimestamp(fetchedAt);
  const liveRef = doc(db, buildingDb, target.docId);
  const liveSnap = await getDoc(liveRef);
  const liveData = liveSnap.exists() ? liveSnap.data() || {} : {};

  // Prefer last successfully saved dump on the doc (survives app restart).
  // Fall back to the in-memory previous text from this session.
  const baselineResponse = String(
    liveData.listResponse || previousResponse || "",
  );

  const existingRows = Array.isArray(liveData[target.fieldKey])
    ? liveData[target.fieldKey]
    : [];

  // Lines already stored in history — never append the same raw message twice.
  const existingRaw = new Set(
    existingRows
      .map((row) => String(row?.rawMessage || row?.message || "").trim())
      .filter(Boolean),
  );

  const newEntries = findNewPanelListEntries(response, baselineResponse).filter(
    (entry) => {
      const raw = String(entry?.raw || entry?.rawMessage || "").trim();
      return raw && !existingRaw.has(raw);
    },
  );
  const newRows = newEntries.map((entry) => listLineToFeedRow(entry, fetchedAtMs));

  const nextRows = newRows.length > 0 ? [...existingRows, ...newRows] : existingRows;

  // Always refresh the saved list dump so the next run can diff correctly.
  await setDoc(
    liveRef,
    {
      [target.fieldKey]: nextRows,
      listCmd: String(listCmd || ""),
      listResponse: String(response || ""),
      lastListSync: new Date(fetchedAtMs).toISOString(),
    },
    { merge: true },
  );

  // Fire also goes into the Alarm messages archive tab.
  if (label === "Fire" && newRows.length > 0) {
    const alarmRef = doc(db, buildingDb, "alarmMessages");
    const alarmSnap = await getDoc(alarmRef);
    const alarmData = alarmSnap.exists() ? alarmSnap.data() || {} : {};
    const existingAlarmRows = Array.isArray(alarmData.alarmMessages)
      ? alarmData.alarmMessages
      : [];

    await setDoc(
      alarmRef,
      { alarmMessages: [...existingAlarmRows, ...newRows] },
      { merge: true },
    );
  }

  return { saved: true, added: newRows.length };
}

/** @deprecated Prefer syncNewListLinesToBuildingFeed — kept for older call sites. */
export async function overwriteBuildingLiveFeed(args) {
  const result = await syncNewListLinesToBuildingFeed(args);
  return Boolean(result?.saved);
}
