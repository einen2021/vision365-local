import { fetchBuildingAlarmHistory } from "@/lib/alarmMessageHistory";
import { extractPanelDeviceAddresses } from "@/lib/firePanelMonitor";
import { stripPanelAddressPrefix } from "@/lib/simplexDeviceAddress";

const HISTORY_FIELD_BY_LABEL = {
  Fire: "liveFire",
  Trouble: "liveTrouble",
  Supervisory: "liveSupervisory",
};

function normalizeAddressKey(address) {
  return stripPanelAddressPrefix(address).toUpperCase();
}

/** Collect device addresses referenced in alarm history messages. */
export function extractHistoryAddressKeys(messages = []) {
  const keys = new Set();

  for (const entry of messages) {
    const text = String(entry?.message || "");
    if (!text) continue;

    for (const address of extractPanelDeviceAddresses(text)) {
      keys.add(address.toUpperCase());
      keys.add(normalizeAddressKey(address));
    }
  }

  return keys;
}

/** True when a panel row already appears in stored alarm history. */
export function isPanelRowInHistory(row, messages = [], historyAddressKeys = null) {
  const keys = historyAddressKeys || extractHistoryAddressKeys(messages);
  const full = String(row?.fullAddress || "").trim().toUpperCase();
  const stripped = normalizeAddressKey(row?.fullAddress || "");

  if (full && keys.has(full)) return true;
  if (stripped && keys.has(stripped)) return true;

  const location = String(row?.location || "").trim().toLowerCase();
  if (!location || location.length < 8) return false;

  return messages.some((entry) =>
    String(entry?.message || "").toLowerCase().includes(location),
  );
}

/** Load live fire/trouble/supervisory history rows for all buildings. */
export async function fetchCategoryHistoryMessages(label, buildingNames = []) {
  const field = HISTORY_FIELD_BY_LABEL[label];
  if (!field) return [];

  const names = [...new Set(buildingNames.map((name) => String(name || "").trim()).filter(Boolean))];
  if (!names.length) return [];

  const chunks = await Promise.all(
    names.map(async (buildingName) => {
      try {
        const history = await fetchBuildingAlarmHistory(buildingName);
        return history[field] || [];
      } catch {
        return [];
      }
    }),
  );

  return chunks.flat();
}

/**
 * Pick only the newest panel row that is not already represented in history
 * or the page baseline snapshot (last unknown row in panel list order).
 */
export function pickNewestUnknownRow(rows, messages, baselineAddresses) {
  const historyKeys = extractHistoryAddressKeys(messages);
  const baseline = baselineAddresses || new Set();
  let newest = null;

  for (const row of rows) {
    if (baseline.has(row.fullAddress)) continue;
    if (isPanelRowInHistory(row, messages, historyKeys)) continue;
    newest = row;
  }

  return newest;
}
