import { collection, doc, getDoc, getDocs, setDoc } from "firebase/firestore";
import { db } from "@/config/firebase";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { syncPanelListWithTempArray, getTempPanelList } from "@/lib/firePanelListHistory";
import { findDeviceAddressByLocationText } from "@/lib/assetsListSimplexStatus";

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

  const existingKeys = new Set(
    existing.map((r) => `${String(r?.message || r?.rawMessage || "").trim()}|${r?.time}`).filter(Boolean),
  );

  const rowsToAppend = [];
  for (const row of newRows) {
    const key = `${String(row?.message || row?.rawMessage || "").trim()}|${row?.time}`;
    if (!existingKeys.has(key)) {
      rowsToAppend.push(row);
      existingKeys.add(key);
    }
  }

  if (rowsToAppend.length === 0) return;

  const combined = [...existing, ...rowsToAppend];
  await setDoc(ref, { [fieldKey]: combined }, { merge: true });
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

/**
 * Records newly detected panel list elements to the History documents:
 * - Fire: writes to liveFire ("Fire History") AND alarmMessages ("Alarm messages" tab)
 * - Trouble: writes to liveTrouble ("Trouble History" tab) ONLY (not alarmMessages)
 * - Supervisory: writes to liveSupervisory ("Supervisory History" tab) ONLY (not alarmMessages)
 * Also appends to fire-list / trouble-list / supervisory-list based on category.
 *
 * @param {string} label - "Fire", "Trouble", or "Supervisory"
 * @param {Array<Object>} newElements - List of newly appeared elements
 */
export async function recordNewElementsToHistory(label, newElements) {
  if (!newElements || !newElements.length) return;

  const normLabel =
    /^trouble$/i.test(label) ? "Trouble" : /^supervisory$/i.test(label) ? "Supervisory" : "Fire";

  const nowMs = Date.now();
  const historyRows = newElements.map((elem) => {
    const timeMs =
      typeof elem.timestamp === "number"
        ? elem.timestamp
        : typeof elem.time === "string"
          ? Date.parse(elem.time) || nowMs
          : nowMs;
    const message = formatHistoryMessage(elem, normLabel);

    return {
      message,
      time: timeMs,
      timestamp: new Date(timeMs).toISOString(),
      rawMessage: elem.raw || elem.rawMessage || message,
      deviceAddress: elem.fullAddress || elem.deviceAddress || "",
    };
  });

  // Also add each new element to fire-list / trouble-list / supervisory-list
  for (const elem of newElements) {
    void appendLiveLogToCategoryList(normLabel, elem);
  }

  // Resolve target buildings and execute writes concurrently
  const targetBuildings = await getAllBuildingNames();
  if (targetBuildings.length === 0) return;

  const writePromises = [];
  for (const buildingName of targetBuildings) {
    const dbCol = buildingDbCollection(buildingName);
    if (!dbCol) continue;

    if (normLabel === "Fire") {
      writePromises.push(appendRowsToDoc(dbCol, "liveFire", "liveFire", historyRows));
      writePromises.push(appendRowsToDoc(dbCol, "alarmMessages", "alarmMessages", historyRows));
    } else if (normLabel === "Trouble") {
      writePromises.push(appendRowsToDoc(dbCol, "liveTrouble", "liveTrouble", historyRows));
    } else if (normLabel === "Supervisory") {
      writePromises.push(appendRowsToDoc(dbCol, "liveSupervisory", "liveSupervisory", historyRows));
    }
  }

  if (writePromises.length > 0) {
    await Promise.all(writePromises);
  }
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
 * Does not alter or add anything extra to the entry.
 *
 * If the raw log line has no address, resolves it via findDeviceAddressByLocationText
 * (matching entry.location against AssetsList deviceLocation/deviceDescription) instead
 * of falling back to a `list f/t/s` panel command.
 *
 * @param {"Fire"|"Trouble"|"Supervisory"|string} label
 * @param {Object|string} entry
 * @returns {Promise<Object|undefined>} the saved list-response-shaped row
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

  let addr =
    typeof entry === "object" && entry
      ? entry.fullAddress ||
        entry.deviceAddress ||
        entry.pointId ||
        rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] ||
        ""
      : rawText.match(/\b(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)\b/i)?.[0] || "";

  // No address on the raw log line — resolve it from the location text instead
  // of running a `list f/t/s` command against the panel.
  const locationText = typeof entry === "object" && entry ? entry.location || "" : "";
  if (!addr && locationText) {
    addr = await findDeviceAddressByLocationText(locationText);
  }

  const timeVal =
    typeof entry === "object" && entry
      ? typeof entry.time === "number"
        ? entry.time
        : typeof entry.at === "string"
          ? Date.parse(entry.at) || Date.now()
          : typeof entry.timestamp === "number"
            ? entry.timestamp
            : Date.now()
      : Date.now();

  const row = {
    fullAddress: (typeof entry === "object" && entry?.fullAddress) || addr,
    deviceAddress: (typeof entry === "object" && entry?.deviceAddress) || addr,
    location: (typeof entry === "object" && entry?.location) || "—",
    deviceType:
      (typeof entry === "object" && (entry?.deviceType || entry?.device || entry?.description)) || "—",
    status:
      (typeof entry === "object" && entry?.status) ||
      (normLabel === "Fire" ? "FIRE" : normLabel === "Trouble" ? "TRBL" : "SUPV"),
    label: (typeof entry === "object" && (entry?.label || entry?.status)) || normLabel.toUpperCase(),
    panelTimeText:
      (typeof entry === "object" && entry?.panelTimeText) ||
      (typeof entry === "object" && entry?.time ? `${entry.time}` : ""),
    time: timeVal,
    timestamp:
      (typeof entry === "object" && entry?.timestamp && typeof entry.timestamp === "string") ||
      new Date(timeVal).toISOString(),
    raw: rawText,
    rawMessage: rawText,
  };

  // 1. Merge into in-memory temporary cache — add this row without dropping
  // (altering) any other row already cached for this category.
  const existingTempRows = getTempPanelList(normLabel);
  const filteredTempRows = existingTempRows.filter((r) => {
    if (addr && (r.fullAddress === addr || r.deviceAddress === addr)) return false;
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
      if (addr && (r.fullAddress === addr || r.deviceAddress === addr)) return false;
      if (rawText && (r.raw === rawText || r.rawMessage === rawText)) return false;
      return true;
    });

    filtered.unshift(row);

    await saveListToCategoryDb(normLabel, filtered);
  } catch (err) {
    console.error(`[appendLiveLogToCategoryList] Failed appending to ${docName}:`, err);
  }

  return row;
}

/** Alias for appendLiveLogToCategoryList */
export const appendLiveAlarmToCategoryList = appendLiveLogToCategoryList;
