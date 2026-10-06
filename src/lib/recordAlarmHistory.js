import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { normalizeBuildingName } from "./buildingNames";
import { syncPanelListWithTempArray, getTempPanelList } from "./firePanelListHistory";

/**
 * Normalizes building name into {BuildingName}BuildingDB collection name.
 */
function buildingDbCollection(buildingName) {
  const base = normalizeBuildingName(buildingName);
  if (!base) return "";
  return base.endsWith("BuildingDB") ? base : `${base}BuildingDB`;
}

/**
 * Resolves all building names from communities and matched assets.
 */
async function getAllBuildingNames(matchedBuildings = []) {
  const names = new Set(matchedBuildings.filter(Boolean));

  try {
    const snapshot = await getDocs(collection(db, "communities"));
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const buildings = data?.buildings || [];
      if (Array.isArray(buildings)) {
        for (const b of buildings) {
          const norm = normalizeBuildingName(b);
          if (norm) names.add(norm);
        }
      }
    }
  } catch (error) {
    console.error("[recordAlarmHistory] Failed to get communities buildings:", error);
  }

  return [...names];
}

/**
 * Appends rows to a document's array field in Firestore without duplicating entries.
 */
async function appendRowsToDoc(dbCol, docId, fieldKey, newRows) {
  if (!dbCol || !docId || !newRows?.length) return;
  const ref = doc(db, dbCol, docId);
  const snap = await getDoc(ref);

  let existing = [];
  if (snap.exists()) {
    const data = snap.data() || {};
    existing = Array.isArray(data[fieldKey]) ? data[fieldKey] : [];
  }

  const rowsToAppend = [];
  for (const row of newRows) {
    const rowMsg = String(row?.message || row?.rawMessage || "").trim();
    const rowTime = Number(row?.time) || 0;

    const isDuplicate = existing.some((ex) => {
      const exMsg = String(ex?.message || ex?.rawMessage || "").trim();
      const exTime = Number(ex?.time) || 0;
      if (exMsg === rowMsg) {
        if (Math.abs(rowTime - exTime) < 30000 || exTime === rowTime) {
          return true;
        }
      }
      return false;
    });

    if (!isDuplicate) {
      rowsToAppend.push(row);
      existing.push(row);
    }
  }

  if (rowsToAppend.length === 0) return;

  await setDoc(ref, { [fieldKey]: existing }, { merge: true });
}

/**
 * Formats a list item into a clean history message string.
 */
function formatHistoryMessage(element, label) {
  if (element.raw || element.rawMessage) {
    return String(element.raw || element.rawMessage).trim();
  }
  const addr = element.fullAddress || element.deviceAddress || "";
  const loc = element.location ? ` at ${element.location}` : "";
  const devType = element.deviceType ? ` ${element.deviceType}` : "";
  return `${label}${loc}${devType} (${addr})`.trim();
}

import { extractPanelEventTime } from "./firePanelMonitor";

/**
 * Records a single live alarm message (converted to list item format) to the History documents:
 * - Fire: writes to liveFire ("Fire History") AND alarmMessages ("Alarm messages" tab)
 * - Trouble: writes to liveTrouble ("Trouble History" tab) ONLY (not alarmMessages)
 * - Supervisory: writes to liveSupervisory ("Supervisory History" tab) ONLY (not alarmMessages)
 *
 * @param {"Fire"|"Trouble"|"Supervisory"|string} label
 * @param {Object} item - { listItem, raw, deviceAddress, time, timestamp }
 */
export async function recordLiveAlarmToHistory(label, item = {}) {
  if (!item || !label) return;

  const normLabel =
    /^trouble$/i.test(label) ? "Trouble" : /^supervisory$/i.test(label) ? "Supervisory" : "Fire";

  const rawMessage = String(item.raw || item.rawMessage || item.message || item.listItem || "").trim();
  if (!rawMessage) return;

  const { timeMs, timestampIso } = extractPanelEventTime(item);

  const historyRow = {
    message: rawMessage,
    rawMessage: rawMessage,
    raw: rawMessage,
    time: timeMs,
    timestamp: timestampIso,
    deviceAddress: item.deviceAddress || "NA",
  };

  const targetBuildings = await getAllBuildingNames();
  if (targetBuildings.length === 0) return;

  const writePromises = [];
  for (const buildingName of targetBuildings) {
    const dbCol = buildingDbCollection(buildingName);
    if (!dbCol) continue;

    if (normLabel === "Fire") {
      writePromises.push(appendRowsToDoc(dbCol, "liveFire", "liveFire", [historyRow]));
      writePromises.push(appendRowsToDoc(dbCol, "alarmMessages", "alarmMessages", [historyRow]));
    } else if (normLabel === "Trouble") {
      writePromises.push(appendRowsToDoc(dbCol, "liveTrouble", "liveTrouble", [historyRow]));
    } else if (normLabel === "Supervisory") {
      writePromises.push(appendRowsToDoc(dbCol, "liveSupervisory", "liveSupervisory", [historyRow]));
    }
  }

  if (writePromises.length > 0) {
    await Promise.all(writePromises);
  }
}

/**
 * Deprecated / No-op for list responses. List responses are no longer recorded to history.
 */
export async function recordNewElementsToHistory(label, newElements) {
  // Intentionally no-op: list responses are not added to history.
}

/**
 * Saves a list command snapshot to the category database ({fire/trouble/supervisory}-list).
 *
 * @param {"Fire"|"Trouble"|"Supervisory"|string} label
 * @param {Array<Object>} parsedRows
 */
export async function saveListToCategoryDb(label, parsedRows = []) {
  const normLabel =
    /^trouble$/i.test(label) ? "Trouble" : /^supervisory$/i.test(label) ? "Supervisory" : "Fire";
  const docName = `${normLabel.toLowerCase()}-list`;
  const now = new Date().toISOString();
  const payload = {
    label: normLabel,
    count: parsedRows.length,
    rows: parsedRows,
    updatedAt: now,
  };

  try {
    // 1. Root collection document (e.g. fire-list/current)
    await setDoc(doc(db, docName, "current"), payload, { merge: true });

    // 2. Also save to panel-lists collection for unified query
    await setDoc(doc(db, "panel-lists", docName), payload, { merge: true });
  } catch (error) {
    console.error(`[recordAlarmHistory] Failed saving ${docName} to DB:`, error);
  }
}

/**
 * When a new fire, trouble, or supervisory event is added (not a list command response),
 * adds it directly to fire-list, trouble-list, or supervisory-list based on category.
 * Extracts time accurately from the message and preserves it.
 *
 * @param {"Fire"|"Trouble"|"Supervisory"|string} label
 * @param {Object|string} entry
 */
export async function appendLiveLogToCategoryList(label, entry) {
  if (!entry || !label) return;

  const normLabel =
    /^trouble$/i.test(label) ? "Trouble" : /^supervisory$/i.test(label) ? "Supervisory" : "Fire";
  const docName = `${normLabel.toLowerCase()}-list`;

  const rawText =
    typeof entry === "string"
      ? entry
      : String(entry.raw || entry.rawMessage || entry.message || "");

  const addr =
    typeof entry === "object" && entry
      ? entry.fullAddress ||
        entry.deviceAddress ||
        entry.pointId ||
        rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] ||
        ""
      : rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] || "";

  const { timeMs, timestampIso, panelTimeText } = extractPanelEventTime(entry);

  const rowAddr = (typeof entry === "object" && (entry?.fullAddress || entry?.deviceAddress)) || addr || "NA";
  const rowLoc = (typeof entry === "object" && entry?.location) || "—";

  const listStatus =
    normLabel === "Fire" ? "FIRE*" : normLabel === "Trouble" ? "TRBL*" : "SUPV*";

  const row = {
    fullAddress: rowAddr,
    deviceAddress: rowAddr,
    location: rowLoc,
    deviceType:
      (typeof entry === "object" && (entry?.deviceType || entry?.device || entry?.description)) || "—",
    status: listStatus,
    label: listStatus.replace(/\*$/, ""),
    panelTimeText: panelTimeText || (typeof entry === "object" && entry?.panelTimeText) || "",
    time: timeMs,
    timestamp: timestampIso,
    raw: rawText,
    rawMessage: rawText,
  };

  // 1. Merge into in-memory temporary cache — add this row without dropping
  // (altering) any other row already cached for this category.
  const existingTempRows = getTempPanelList(normLabel);
  const filteredTempRows = existingTempRows.filter((r) => {
    if (rowAddr && rowAddr !== "NA" && (r.fullAddress === rowAddr || r.deviceAddress === rowAddr)) return false;
    if (rowLoc && rowLoc !== "—" && r.location === rowLoc) return false;
    if (rawText && (r.raw === rawText || r.rawMessage === rawText)) return false;
    return true;
  });
  syncPanelListWithTempArray(normLabel, [row, ...filteredTempRows]);

  // 2. Add to category list document ({fire/trouble/supervisory}-list)
  try {
    const currentRef = doc(db, docName, "current");
    const snap = await getDoc(currentRef);
    let existingRows = [];
    if (snap.exists() && Array.isArray(snap.data()?.rows)) {
      existingRows = snap.data().rows;
    }

    const filtered = existingRows.filter((r) => {
      if (rowAddr && rowAddr !== "NA" && (r.fullAddress === rowAddr || r.deviceAddress === rowAddr)) return false;
      if (rowLoc && rowLoc !== "—" && r.location === rowLoc) return false;
      if (rawText && (r.raw === rawText || r.rawMessage === rawText)) return false;
      return true;
    });

    filtered.unshift(row);

    await saveListToCategoryDb(normLabel, filtered);
  } catch (err) {
    console.error(`[appendLiveLogToCategoryList] Failed appending to ${docName}:`, err);
  }
}

/** Alias for appendLiveLogToCategoryList */
export const appendLiveAlarmToCategoryList = appendLiveLogToCategoryList;

