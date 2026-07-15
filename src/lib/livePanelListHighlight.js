import {
  extractPanelDeviceAddresses,
  parsePanelListResponse,
} from "@/lib/firePanelMonitor";
import { stripPanelAddressPrefix } from "@/lib/simplexDeviceAddress";

/**
 * Compare a new list f/t/s response with the previously saved one.
 * Returns only panel lines that were not in the previous response.
 * Matching is by exact raw line text (status / panel time changes count as new).
 */
export function findNewPanelListEntries(currentResponse = "", previousResponse = "") {
  const previousRaw = new Set(
    parsePanelListResponse(previousResponse)
      .map((entry) => String(entry?.raw || entry?.rawMessage || "").trim())
      .filter(Boolean),
  );

  const newlyAppeared = [];
  for (const entry of parsePanelListResponse(currentResponse)) {
    const raw = String(entry?.raw || entry?.rawMessage || "").trim();
    if (!raw) continue;
    if (previousRaw.has(raw)) continue;
    newlyAppeared.push(entry);
    // Same line shouldn't be treated as new twice in one pass.
    previousRaw.add(raw);
  }

  return newlyAppeared;
}

/**
 * From a full panel list (old + new), keep only addresses that were not in the
 * previous snapshot. The last one in panel order is treated as the newest event.
 */
export function pickNewestAppearedAddresses(currentAddresses = [], previousAddresses = []) {
  const prevSet = new Set(
    (previousAddresses || [])
      .map((address) => String(address || "").trim().toUpperCase())
      .filter(Boolean),
  );

  const newlyAppeared = [];
  for (const address of currentAddresses || []) {
    const key = String(address || "").trim().toUpperCase();
    if (!key) continue;
    if (prevSet.has(key)) continue;
    newlyAppeared.push(String(address).trim());
  }

  if (newlyAppeared.length === 0) return [];
  // Only the latest new device — not every prior alarm still present in the list.
  return [newlyAppeared[newlyAppeared.length - 1]];
}

/** Normalize an address for Set lookups (optional panel prefix stripped). */
export function normalizeAddressKey(address) {
  return stripPanelAddressPrefix(address).toUpperCase();
}

/** Collect unique panel addresses from raw list text. */
export function addressesFromListResponse(response) {
  return extractPanelDeviceAddresses(response);
}
