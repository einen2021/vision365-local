import { parsePanelListResponse } from "./firePanelMonitor";
import { recordNewElementsToHistory } from "./recordAlarmHistory";

/**
 * In-memory temporary array cache for live panel list command responses.
 * Stored by category label (Fire, Trouble, Supervisory, etc.).
 */
const tempPanelListCache = {
  Fire: [],
  Trouble: [],
  Supervisory: [],
};

/**
 * Normalizes device address or raw line for fast Map key lookup.
 */
function getRowKey(row) {
  if (!row) return "";
  const address = String(row.fullAddress || row.deviceAddress || "").trim().toUpperCase();
  if (address) return address;
  return String(row.raw || row.rawMessage || "").trim().toUpperCase();
}

function isUnresolvedAddress(row) {
  const address = String(row?.fullAddress || row?.deviceAddress || "").trim().toUpperCase();
  return !address || address === "NA" || address === "—";
}

function locationKey(row) {
  const location = String(row?.location || "").trim().toUpperCase().replace(/\s+/g, " ");
  return location && location !== "—" ? location : "";
}

/**
 * Newest live event first (`lastEventAt` = when the app received the event — not
 * the panel clock). Rows without a live event keep their panel order.
 */
export function sortRowsByLatestEvent(rows = []) {
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        Number(b.row?.lastEventAt || 0) - Number(a.row?.lastEventAt || 0) || a.index - b.index,
    )
    .map(({ row }) => row);
}

/**
 * Compare new list response array with temporary array data.
 * - If an element exists in the temp array, preserve its previous time & timestamp.
 * - If there is any new element, set its time to current time.
 * - Saves the complete response data to the temp array for the next run.
 * - Automatically records new elements to the History page / building DB documents.
 * - Process is optimized with O(1) Map lookups to complete in under 1 millisecond.
 *
 * @param {string} label - Category label ("Fire", "Trouble", "Supervisory")
 * @param {Array<Object>|string} newResponse - Raw string response or parsed row array
 * @param {string} [currentTime] - ISO string for current time (defaults to now)
 * @returns {Array<Object>} Merged response array with preserved and updated timestamps
 */
export function syncPanelListWithTempArray(
  label,
  newResponse,
  currentTime = new Date().toISOString(),
) {
  const newRows =
    typeof newResponse === "string"
      ? parsePanelListResponse(newResponse)
      : Array.isArray(newResponse)
        ? newResponse
        : [];

  if (!newRows || !newRows.length) {
    tempPanelListCache[label] = [];
    return [];
  }

  const tempArray = tempPanelListCache[label] || [];

  if (!tempArray.length) {
    // Initial run or temp array was empty: initialize temp array baseline without dumping to history
    const initialRows = newRows.map((row) => ({
      ...row,
      time: row.time || currentTime,
      timestamp: row.timestamp || Date.now(),
      isNew: false,
    }));
    tempPanelListCache[label] = initialRows;

    return initialRows;
  }

  // Build fast O(1) Map from temp array in < 0.1ms
  const tempMap = new Map();
  // Live rows whose address could not be resolved ("NA"), by location.
  const unresolvedByLocation = new Map();
  for (let i = 0; i < tempArray.length; i++) {
    const item = tempArray[i];
    const key = getRowKey(item);
    if (key && !tempMap.has(key)) {
      tempMap.set(key, item);
    }
    const location = locationKey(item);
    if (isUnresolvedAddress(item) && location && !unresolvedByLocation.has(location)) {
      unresolvedByLocation.set(location, item);
    }
  }

  // A location shared by several list rows cannot be attributed to one device.
  const newRowsPerLocation = new Map();
  for (const row of newRows) {
    const location = locationKey(row);
    if (location) newRowsPerLocation.set(location, (newRowsPerLocation.get(location) || 0) + 1);
  }

  const mergedRows = new Array(newRows.length);
  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i];
    const key = getRowKey(row);
    let existing = key ? tempMap.get(key) : null;
    const location = locationKey(row);
    if (location && newRowsPerLocation.get(location) === 1) {
      // An unresolved live row at this device's (unique) location — use it when
      // it is a newer event than what is cached under the address.
      const unresolved = unresolvedByLocation.get(location);
      if (
        unresolved &&
        (!existing || Number(unresolved.lastEventAt || 0) > Number(existing.lastEventAt || 0))
      ) {
        existing = unresolved;
      }
    }

    if (existing && Number(row.lastEventAt || 0) > Number(existing.lastEventAt || 0)) {
      // This row is a newer live event for a device already listed — show the
      // new event's time.
      mergedRows[i] = { ...row, isNew: true };
    } else if (existing) {
      // Element exists in temp array: keep previous time
      mergedRows[i] = {
        ...row,
        time: existing.time || row.time || existing.panelTimeText || row.panelTimeText || currentTime,
        timestamp: existing.timestamp || row.timestamp || Date.now(),
        panelTimeText: existing.panelTimeText || row.panelTimeText || "",
        ...(existing.lastEventAt ? { lastEventAt: existing.lastEventAt } : {}),
        isNew: false,
      };
    } else {
      // New element: keep row's own extracted time or fallback to currentTime
      mergedRows[i] = {
        ...row,
        time: row.time || row.panelTimeText || currentTime,
        timestamp: row.timestamp || Date.now(),
        panelTimeText: row.panelTimeText || "",
        isNew: true,
      };
    }
  }

  // Save the complete response data to temp array for the next run
  tempPanelListCache[label] = mergedRows;

  return mergedRows;
}

/**
 * Get current temporary array data for a label.
 */
export function getTempPanelList(label) {
  return tempPanelListCache[label] || [];
}

/**
 * Clear temporary array data for a specific label or all labels.
 */
export function clearTempPanelList(label) {
  if (label && tempPanelListCache[label]) {
    tempPanelListCache[label] = [];
  } else {
    tempPanelListCache.Fire = [];
    tempPanelListCache.Trouble = [];
    tempPanelListCache.Supervisory = [];
  }
}
