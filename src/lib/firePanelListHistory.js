import { parsePanelListResponse } from "@/lib/firePanelMonitor";
import { recordNewElementsToHistory } from "@/lib/recordAlarmHistory";

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
  for (let i = 0; i < tempArray.length; i++) {
    const item = tempArray[i];
    const key = getRowKey(item);
    if (key && !tempMap.has(key)) {
      tempMap.set(key, item);
    }
  }

  const mergedRows = new Array(newRows.length);
  for (let i = 0; i < newRows.length; i++) {
    const row = newRows[i];
    const key = getRowKey(row);
    const existing = key ? tempMap.get(key) : null;

    if (existing) {
      // Element exists in temp array: keep previous time
      mergedRows[i] = {
        ...row,
        time: existing.time || existing.panelTimeText || currentTime,
        timestamp: existing.timestamp || Date.now(),
        isNew: false,
      };
    } else {
      // New element: update its time to current time
      mergedRows[i] = {
        ...row,
        time: currentTime,
        timestamp: Date.now(),
        isNew: true,
      };
    }
  }

  // Save the complete response data to temp array for the next run
  tempPanelListCache[label] = mergedRows;

  const newElements = mergedRows.filter((r) => r.isNew);
  if (newElements.length > 0) {
    void recordNewElementsToHistory(label, newElements).catch((err) => {
      console.error("[history] Failed to record new elements to history:", err);
    });
  }

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
