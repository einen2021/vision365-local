/**
 * Match panel list output to AssetsList devices and update building alarmDetails.
 *
 * Example list line:
 * M1-3       P1/L1/2B/CAR PARK/3    SMOKE DETECTOR    TRBL*
 */

import {
  getDocument,
  readDb,
  setDocument,
  withDbMutate,
} from "../db/documentStore";
import { serverLog } from "../log";
import { sendFirePanelCommand } from "./firePanelService";

export type AlarmCategory = "fire" | "trouble" | "supervisory";

/** Root-level doc for raw panel CVAL totals (not per-building alarmDetails). */
const PANEL_STATE_DOC = "firePanelState";

export interface PanelCategoryCounts {
  totalFire: number;
  totalTrouble: number;
  totalSupervisory: number;
  lastPanelSync: string | null;
}

export function labelToCategory(label: string): AlarmCategory {
  const normalized = label.trim().toLowerCase();
  if (normalized === "trouble") return "trouble";
  if (normalized === "supervisory") return "supervisory";
  return "fire";
}

function panelCountsFromDb(db: Record<string, unknown>): PanelCategoryCounts {
  const doc = getDocument(db, [PANEL_STATE_DOC]) as Record<string, unknown> | null;
  return {
    totalFire: Number(doc?.totalFire) || 0,
    totalTrouble: Number(doc?.totalTrouble) || 0,
    totalSupervisory: Number(doc?.totalSupervisory) || 0,
    lastPanelSync:
      typeof doc?.lastPanelSync === "string" ? doc.lastPanelSync : null,
  };
}

/** Read root firePanelState document (panel CVAL totals, not BuildingDB). */
export function getStoredPanelStateFromDb(
  db: Record<string, unknown>,
): PanelCategoryCounts {
  return panelCountsFromDb(db);
}

export async function getStoredPanelState(): Promise<PanelCategoryCounts> {
  const db = await readDb();
  return panelCountsFromDb(db);
}

function previousCountForCategory(
  counts: PanelCategoryCounts,
  category: AlarmCategory,
): number {
  if (category === "trouble") return counts.totalTrouble;
  if (category === "supervisory") return counts.totalSupervisory;
  return counts.totalFire;
}

/** Read persisted panel CVAL count for one category (root firePanelState, not BuildingDB). */
export async function getPanelCategoryCount(
  category: AlarmCategory,
): Promise<number> {
  const db = await readDb();
  return previousCountForCategory(panelCountsFromDb(db), category);
}

/** Persist panel CVAL count for one category after a successful poll/sync. */
export async function savePanelCategoryCount(
  category: AlarmCategory,
  count: number,
): Promise<void> {
  let decreased = false;
  await withDbMutate((db, { markDirty }) => {
    const existing =
      (getDocument(db, [PANEL_STATE_DOC]) as Record<string, unknown>) || {};
    const totalField = totalFieldForCategory(category);
    const prevCount = Number(existing[totalField]) || 0;
    const now = new Date().toISOString();

    if (prevCount === count) return;
    if (count < prevCount && category !== "fire") {
      decreased = true;
    }

    setDocument(
      db,
      [PANEL_STATE_DOC],
      {
        ...existing,
        [totalField]: count,
        lastPanelSync: now,
      },
      true,
    );
    markDirty([PANEL_STATE_DOC]);

    serverLog(
      `[fire-panel] firePanelState → ${totalField}=${count} (previous panel count: ${prevCount})`,
    );
  });

  if (decreased && (category === "trouble" || category === "supervisory")) {
    try {
      await syncCategoryOnCountDecrease(category, count);
    } catch (error) {
      serverLog(
        `[fire-panel] Error executing startup list sync for decreased category ${category}: ${(error as Error).message}`,
      );
    }
  }
}

/**
 * Re-enabling a device (`disable <addr> off`) drops the trouble count by one.
 * The app clears that device's trouble row itself, so the drop is "expected"
 * for a while and does not re-run `list t` (see savePanelStateCounts).
 */
const EXPECTED_TROUBLE_DROP_TTL_MS = 30000;
let expectedTroubleDrops: number[] = [];

function pruneExpectedTroubleDrops() {
  const now = Date.now();
  expectedTroubleDrops = expectedTroubleDrops.filter((at) => now - at < EXPECTED_TROUBLE_DROP_TTL_MS);
}

export function expectEnabledTroubleDrop() {
  pruneExpectedTroubleDrops();
  expectedTroubleDrops.push(Date.now());
}

/** True when a drop of `drop` is fully explained by re-enabled devices (consumed). */
function consumeExpectedTroubleDrop(drop: number): boolean {
  pruneExpectedTroubleDrops();
  if (drop <= 0 || expectedTroubleDrops.length < drop) return false;
  expectedTroubleDrops.splice(0, drop);
  return true;
}

/** Persist all three CVAL totals to firePanelState (e.g. after monitor cycle). */
export async function savePanelStateCounts(counts: {
  totalFire: number;
  totalTrouble: number;
  totalSupervisory: number;
}): Promise<PanelCategoryCounts & { unchanged?: boolean }> {
  let result: PanelCategoryCounts & { unchanged?: boolean };
  const decreasedCategories: Array<{
    category: "trouble" | "supervisory";
    nextCount: number;
  }> = [];

  await withDbMutate((db, { markDirty }) => {
    const existing = panelCountsFromDb(db);
    const next = {
      totalFire: Number(counts.totalFire),
      totalTrouble: Number(counts.totalTrouble),
      totalSupervisory: Number(counts.totalSupervisory),
    };

    if (
      existing.totalFire === next.totalFire &&
      existing.totalTrouble === next.totalTrouble &&
      existing.totalSupervisory === next.totalSupervisory
    ) {
      result = { ...existing, unchanged: true };
      return;
    }

    const now = new Date().toISOString();
    const payload = { ...next, lastPanelSync: now };
    const doc =
      (getDocument(db, [PANEL_STATE_DOC]) as Record<string, unknown>) || {};

    setDocument(
      db,
      [PANEL_STATE_DOC],
      {
        ...doc,
        ...payload,
      },
      true,
    );
    markDirty([PANEL_STATE_DOC]);

    const changes: string[] = [];
    if (existing.totalFire !== next.totalFire) {
      changes.push(`fire ${existing.totalFire}→${next.totalFire}`);
    }
    if (existing.totalSupervisory !== next.totalSupervisory) {
      changes.push(`supervisory ${existing.totalSupervisory}→${next.totalSupervisory}`);
      if (next.totalSupervisory < existing.totalSupervisory) {
        decreasedCategories.push({
          category: "supervisory",
          nextCount: next.totalSupervisory,
        });
      }
    }
    if (existing.totalTrouble !== next.totalTrouble) {
      changes.push(`trouble ${existing.totalTrouble}→${next.totalTrouble}`);
      if (
        next.totalTrouble < existing.totalTrouble &&
        consumeExpectedTroubleDrop(existing.totalTrouble - next.totalTrouble)
      ) {
        changes.push("(re-enabled device — no list t)");
      } else if (next.totalTrouble < existing.totalTrouble) {
        decreasedCategories.push({
          category: "trouble",
          nextCount: next.totalTrouble,
        });
      }
    }
    if (changes.length > 0) {
      serverLog(`[fire-panel] firePanelState → ${changes.join(", ")}`);
    }

    result = payload;
  });

  // Fire first: while FIRE > 0 no `list t` / `list s` and no T / S flag change —
  // the app re-lists trouble / supervisory once the fire count is 0.
  if (Number(counts.totalFire) > 0) {
    if (decreasedCategories.length > 0) {
      serverLog(
        `[fire-panel] Fire active (FIRE=${counts.totalFire}) — ${decreasedCategories.map((d) => d.category).join(" / ")} re-sync held`,
      );
    }
    return result!;
  }

  // If any category count decreased from previous (except fire), do all the steps in startUpListSync for that category
  for (const { category, nextCount } of decreasedCategories) {
    try {
      await syncCategoryOnCountDecrease(category, nextCount);
    } catch (error) {
      serverLog(
        `[fire-panel] Error executing startup list sync for decreased category ${category}: ${(error as Error).message}`,
      );
    }
  }

  return result!;
}

const PANEL_DEVICE_TYPES = [
  "SMOKE DETECTOR",
  "HEAT DETECTOR",
  "DUCT DETECTOR",
  "BEAM DETECTOR",
  "PULL STATION",
  "MANUAL STATION",
  "WATER FLOW",
  "FLOW SWITCH",
  "MONITOR MODULE",
  "CONTROL MODULE",
  "RELAY MODULE",
  "AUXILIARY RELAY",
  "ALARM RELAY",
  "TROUBLE POINT",
  "HORN STROBE",
  "SPEAKER STROBE",
  "TAMPER SWITCH",
  "GATE VALVE",
  "FIRE MONITOR",
  "SUPERVISORY",
  "MONITOR ZN",
  "HORN",
  "STROBE",
  "SPEAKER",
  "MODULE",
  "DETECTOR",
  "STATION",
  "RELAY",
  "SWITCH",
  "VALVE",
];

const KNOWN_STATUS_TOKENS = new Set([
  "TRBL",
  "TRBL*",
  "TROUBLE",
  "TROUBLE*",
  "FIRE",
  "FIRE*",
  "ALARM",
  "ALARM*",
  "SUPV",
  "SUPV*",
  "SUPERVISORY",
  "SUPERVISORY*",
  "PRI2",
  "PRI2*",
  "DISABLE",
  "DISABLED",
  "DISAB",
  "NORMAL",
  "NORMAL*",
  "ACKED",
  "TEST",
  "OPEN",
  "SHORT",
  "ACTIVE",
  "OFF",
  "ON",
]);

function stripListCommandEcho(line: string) {
  return String(line || "")
    .replace(/\0/g, " ")
    .replace(/^list\s+[fts]\s*/i, "")
    .replace(/^list\s+[fts](?=\d*:?M\d)/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface DetailedPanelListEntry {
  fullAddress: string;
  deviceAddress: string;
  location: string;
  deviceType: string;
  status: string;
  label: string;
  panelTimeText: string;
  time: number;
  timestamp: string;
  raw: string;
  rawMessage: string;
}

export function parseDetailedPanelListLine(line: string): DetailedPanelListEntry | null {
  const trimmed = stripListCommandEcho(line);
  if (!trimmed) return null;
  if (/_DNE|_END\b/i.test(trimmed)) return null;
  if (trimmed === "-") return null;
  if (/^list\s/i.test(trimmed)) return null;
  if (/FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+|PRIORITY2\s*=\s*\d+/i.test(trimmed)) return null;
  if (/^show\s+counts/i.test(trimmed)) return null;

  const match = trimmed.match(
    /^(?:(\d+):)?(M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+|\d+-\d+(?:-\d+)?)(?:\s+(.*))?$/i,
  );
  if (!match) return null;

  const node = match[1] || "";
  const deviceAddress = match[2].toUpperCase();
  const fullAddress = node ? `${node}:${deviceAddress}` : deviceAddress;
  let remainder = String(match[3] || "").trim();
  let panelTimeText = "";

  const leadingDateTime = remainder.match(
    /^(\d{1,2}-[A-Za-z]{3}-\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s+/,
  );
  const leadingTime = remainder.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/);

  if (leadingDateTime) {
    panelTimeText = leadingDateTime[1];
    remainder = remainder.slice(leadingDateTime[0].length).trim();
  } else if (leadingTime) {
    panelTimeText = leadingTime[1];
    remainder = remainder.slice(leadingTime[0].length).trim();
  }

  let status = "";
  const words = remainder.split(/\s+/);
  if (words.length > 0) {
    const lastWord = words[words.length - 1].toUpperCase();
    if (KNOWN_STATUS_TOKENS.has(lastWord)) {
      status = lastWord;
      words.pop();
      remainder = words.join(" ").trim();
    }
  }

  if (!panelTimeText) {
    const trailingDateTime = remainder.match(
      /\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$/,
    );
    const trailingTime = remainder.match(/\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$/);
    if (trailingDateTime) {
      panelTimeText = trailingDateTime[1];
      remainder = remainder.slice(0, trailingDateTime.index).trim();
    } else if (trailingTime) {
      panelTimeText = trailingTime[1];
      remainder = remainder.slice(0, trailingTime.index).trim();
    }
  }

  let deviceType = "";
  let location = remainder;
  const upperRemainder = remainder.toUpperCase();

  const cardMatch = upperRemainder.match(/\bCARD\s*[-]?\s*(\d+)\b/i);
  if (cardMatch) {
    deviceType = `CARD ${cardMatch[1]}`;
    location = remainder.replace(/\bCARD\s*[-]?\s*\d+\b/i, "").trim();
  } else {
    for (const type of PANEL_DEVICE_TYPES) {
      if (upperRemainder.endsWith(type)) {
        deviceType = type;
        location = remainder.slice(0, remainder.length - type.length).trim();
        break;
      }
    }
  }

  if (!deviceType && remainder) {
    if (/^P\d+$/i.test(deviceAddress)) {
      deviceType = "TROUBLE POINT";
      location = remainder;
    } else {
      const remWords = remainder.split(/\s+/);
      if (remWords.length >= 3) {
        deviceType = remWords.slice(-2).join(" ").toUpperCase();
        location = remWords.slice(0, -2).join(" ");
      } else if (remWords.length === 2) {
        deviceType = remWords[1].toUpperCase();
        location = remWords[0];
      } else {
        location = remainder;
        deviceType = "—";
      }
    }
  }

  if (!status) {
    status = "TRBL";
  }

  const nowMs = Date.now();
  return {
    fullAddress,
    deviceAddress,
    location: location || "—",
    deviceType: deviceType || "—",
    status,
    label: status.replace(/\*$/, ""),
    panelTimeText,
    time: nowMs,
    timestamp: new Date(nowMs).toISOString(),
    raw: trimmed,
    rawMessage: trimmed,
  };
}

export function parseDetailedPanelListResponse(
  text: string,
): DetailedPanelListEntry[] {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/);
  const rows: DetailedPanelListEntry[] = [];
  for (const line of lines) {
    const parsed = parseDetailedPanelListLine(line);
    if (parsed) rows.push(parsed);
  }
  return rows;
}

/**
 * Execute all steps in startUpListSync for a category (trouble or supervisory)
 * when its count decreases from previous.
 */
export async function syncCategoryOnCountDecrease(
  category: "trouble" | "supervisory",
  expectedCount: number,
): Promise<void> {
  const normLabel = category === "trouble" ? "Trouble" : "Supervisory";
  const listCmd = category === "trouble" ? "list t" : "list s";
  const docName = `${category}-list`;

  let parsedRows: DetailedPanelListEntry[] = [];
  let rawRes = "";

  if (expectedCount === 0) {
    serverLog(
      `[fire-panel] [startupSync] ${normLabel} count dropped to 0, saving empty list to database...`,
    );
    parsedRows = [];
  } else {
    serverLog(
      `[fire-panel] [startupSync] ${normLabel} count decreased to ${expectedCount}. Running ${listCmd} (expecting ~${expectedCount} items)...`,
    );
    const maxAttempts = 10;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const timeoutMs = Math.max(30000, Math.min(120000, expectedCount * 250 + 15000));
      try {
        const res = await sendFirePanelCommand(listCmd, timeoutMs, expectedCount);
        rawRes = res?.response || "";
      } catch (err) {
        const message = (err as Error).message || "";
        serverLog(
          `[fire-panel] [startupSync] Error sending ${listCmd}: ${message}`,
        );
        // Held for a fire: keep the stored list and flags (the app re-lists after it).
        if (/Fire alarm active/i.test(message)) return;
        break;
      }

      parsedRows = parseDetailedPanelListResponse(rawRes);
      const isCountConfirmed =
        parsedRows.length >= expectedCount ||
        (parsedRows.length >= Math.floor(expectedCount * 0.95) &&
          /_DNE|_END|\n-\s*$/i.test(rawRes));

      if (isCountConfirmed) {
        break;
      }

      if (attempt === maxAttempts) {
        serverLog(
          `[fire-panel] [startupSync] ${listCmd} completed with ${parsedRows.length}/${expectedCount} items after ${attempt} attempts. Proceeding to save...`,
        );
        break;
      }

      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // A fire reported meanwhile: keep the stored list and T / S flags as they are.
  if ((await getStoredPanelState()).totalFire > 0) {
    serverLog(`[fire-panel] [startupSync] Fire active — ${listCmd} result not saved`);
    return;
  }

  // Save to DB and sync assets / building totals
  await withDbMutate((db, { markDirty }) => {
    const now = new Date().toISOString();
    const payload = {
      label: normLabel,
      count: parsedRows.length,
      rows: parsedRows,
      updatedAt: now,
    };

    // 1. Save complete list to category DB ({fire/trouble/supervisory}-list)
    setDocument(db, [docName, "current"], payload, true);
    setDocument(db, ["panel-lists", docName], payload, true);
    markDirty();

    // 2. Sync AssetsList and building alarmDetails category totals
    const assetsList = getAssetsList(db);
    if (Object.keys(assetsList).length > 0) {
      const statusKey = statusKeyForCategory(category);
      applyCategoryListToAssets(
        assetsList,
        category,
        { total: parsedRows.length, list: rawRes },
        markDirty,
      );

      const buildingCounts = recountCategoryPerBuilding(assetsList, statusKey);
      const buildingsWithAssets = collectBuildingsWithAssets(assetsList);
      updateBuildingCategoryTotal(
        db,
        category,
        buildingCounts,
        buildingsWithAssets,
        markDirty,
      );
    }
  });

  serverLog(
    `[fire-panel] [startupSync] Saving ${docName} to DB complete (${parsedRows.length} items).`,
  );
}

export interface PanelListEntry {
  deviceAddress: string;
  /** Address with panel prefix when the panel printed one (e.g. "2:M1-2-0"). */
  fullAddress: string;
  label: string;
  raw: string;
}

type DbAsset = Record<string, unknown>;
type AssetsListMap = Record<string, DbAsset>;

export interface CategoryAlarmResult {
  total: number;
  list: string | null;
}

const M_ADDRESS_RE = /^M\d+-\d+(?:-\d+)?$/i;

function normalizeAddress(value: unknown) {
  return String(value || "")
    .replace(/\0/g, "")
    .trim()
    .replace(/^\d+:/i, "")
    .trim()
    .toUpperCase();
}

function buildMAddress(loop: unknown, device: unknown, subAdd?: unknown) {
  const loopN = Number(loop);
  const deviceN = Number(device);
  if (!loopN || !deviceN) return "";
  const base = `M${loopN}-${deviceN}`;
  const sub = Number(subAdd);
  if (sub > 0) return `${base}-${sub}`;
  return base;
}

/** Match uploaded AssetsList rows by deviceAddress, partNumber, or loop/device. */
function getAssetDeviceAddress(asset: DbAsset) {
  const candidates = [
    normalizeAddress(asset.deviceAddress),
    normalizeAddress(asset.partNumber),
    normalizeAddress(
      buildMAddress(asset.loopNumber, asset.deviceNumber, asset.subAdd),
    ),
  ];

  for (const candidate of candidates) {
    if (M_ADDRESS_RE.test(candidate)) return candidate;
  }

  return candidates.find(Boolean) || "";
}

function getBuildingName(asset: DbAsset) {
  return String(asset.building || asset.buildingName || "").trim();
}

function getAssetsList(db: Record<string, unknown>): AssetsListMap {
  const list = db.AssetsList;
  if (list && typeof list === "object" && !Array.isArray(list)) {
    return list as AssetsListMap;
  }
  return {};
}

/** Parse panel `list f|t|s` text into device rows */
export function parsePanelListResponse(text: string): PanelListEntry[] {
  const entries: PanelListEntry[] = [];

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/_DNE/i.test(trimmed)) continue;
    if (/^list\s/i.test(trimmed)) continue;

    // Panel rows carry a node prefix ("2:M1-2-0 ..."); P-points and card
    // addresses ("P209", "1-0-0") are list rows too. Matching only a bare
    // "M1-..." start parsed 0 rows, so every device's flag was cleared and
    // none re-set.
    const addressMatch = trimmed.match(
      /^(?:(\d+):)?(M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+)(?:\s+|$)/i,
    );
    if (!addressMatch) continue;

    const deviceAddress = addressMatch[2].toUpperCase();
    const fullAddress = addressMatch[1] ? `${addressMatch[1]}:${deviceAddress}` : deviceAddress;
    const labelMatch = trimmed.match(/\s([A-Z]{2,6})\*?\s*$/i);
    const label = (labelMatch?.[1] || "").toUpperCase();

    entries.push({ deviceAddress, fullAddress, label, raw: trimmed });
  }

  return entries;
}

function statusKeyForCategory(category: AlarmCategory) {
  if (category === "fire") return "F";
  if (category === "trouble") return "T";
  return "S";
}

type StatusKey = "F" | "T" | "S";

/** Map panel row suffix (TRBL*, ALRM*, SUPV*) to F/T/S flags. */
function flagsFromLabel(
  label: string,
  category: AlarmCategory,
): Partial<Record<StatusKey, 1>> {
  const flags: Partial<Record<StatusKey, 1>> = {};

  if (/^(ALRM|FIRE|ALM)/i.test(label)) flags.F = 1;
  if (/^TRBL/i.test(label)) flags.T = 1;
  if (/^(SUPV|SUPR|SUP)/i.test(label)) flags.S = 1;

  if (Object.keys(flags).length === 0) {
    flags[statusKeyForCategory(category)] = 1;
  }

  return flags;
}

function getSimplexStatus(asset: DbAsset): Record<string, unknown> {
  const existing = asset.simplexStatus;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  return {};
}

/** Update only simplexStatus.F / .T / .S; leave other asset fields untouched. */
function setSimplexFlags(
  asset: DbAsset,
  flags: Partial<Record<StatusKey, 0 | 1>>,
) {
  const status = getSimplexStatus(asset);

  if (flags.F !== undefined) status.F = flags.F;
  if (flags.T !== undefined) status.T = flags.T;
  if (flags.S !== undefined) status.S = flags.S;

  asset.simplexStatus = status;
}

function collectAddressMatchKeys(rawAddress?: string | null): Set<string> {
  const keys = new Set<string>();
  if (!rawAddress) return keys;
  const clean = String(rawAddress).trim().toUpperCase();
  if (!clean) return keys;
  keys.add(clean);

  const match = clean.match(
    /^(?:(\d+):)?(M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+|\d+-\d+(?:-\d+)?)$/i,
  );
  if (match) {
    const node = match[1] || "";
    const dev = match[2].toUpperCase();
    keys.add(dev);

    if (dev.endsWith("-0")) {
      keys.add(dev.slice(0, -2));
      if (node) {
        keys.add(`${node}:${dev.slice(0, -2)}`);
      }
    } else if (/^M\d+-\d+$/i.test(dev)) {
      keys.add(`${dev}-0`);
      if (node) {
        keys.add(`${node}:${dev}-0`);
      }
    }
    if (node) {
      keys.add(`${node}:${dev}`);
    }
  }

  return keys;
}

function collectAssetMatchKeys(asset: DbAsset, id: string): Set<string> {
  const keys = new Set<string>();
  for (const candidate of [
    id,
    asset.deviceAddress,
    asset.partNumber,
    asset.address,
    asset.simplexAddress,
    buildMAddress(asset.loopNumber, asset.deviceNumber, asset.subAdd),
  ]) {
    for (const key of collectAddressMatchKeys(candidate as any)) {
      keys.add(key);
    }
  }
  return keys;
}

function buildAddressIndex(assetsList: AssetsListMap) {
  const index = new Map<string, Array<{ id: string; asset: DbAsset }>>();

  for (const [id, asset] of Object.entries(assetsList)) {
    const entryItem = { id, asset };
    for (const key of collectAssetMatchKeys(asset, id)) {
      const bucket = index.get(key) || [];
      if (!bucket.some((b) => b.id === id)) {
        bucket.push(entryItem);
      }
      index.set(key, bucket);
    }
  }

  return index;
}

function buildingDbName(building: string) {
  return building.endsWith("BuildingDB") ? building : `${building}BuildingDB`;
}

function totalFieldForCategory(category: AlarmCategory) {
  if (category === "fire") return "totalFire";
  if (category === "trouble") return "totalTrouble";
  return "totalSupervisory";
}

function collectBuildingsWithAssets(assetsList: AssetsListMap) {
  const buildings = new Set<string>();
  for (const asset of Object.values(assetsList)) {
    const building = getBuildingName(asset);
    if (building) buildings.add(building);
  }
  return buildings;
}

/** Update one totalFire / totalTrouble / totalSupervisory field per building. */
function updateBuildingCategoryTotal(
  db: Record<string, unknown>,
  category: AlarmCategory,
  buildingCounts: Map<string, number>,
  buildingsWithAssets: Set<string>,
  markDirty: () => void,
) {
  const now = new Date().toISOString();
  const totalField = totalFieldForCategory(category);

  for (const building of buildingsWithAssets) {
    const count = buildingCounts.get(building) || 0;
    const buildingDb = buildingDbName(building);
    const existing =
      (getDocument(db, [buildingDb, "alarmDetails"]) as Record<
        string,
        unknown
      >) || {};

    const next = {
      ...existing,
      [totalField]: count,
      panelStatus: true,
      lastPanelSync: now,
    };

    if (
      Number(existing[totalField]) === count &&
      existing.panelStatus === true
    ) {
      continue;
    }

    setDocument(db, [buildingDb, "alarmDetails"], next, true);
    markDirty();

    serverLog(
      `[fire-panel] ${buildingDb} alarmDetails → ${totalField}=${count}`,
    );
  }
}

export interface StoredPanelAlarmTotals {
  totalFire: number;
  totalTrouble: number;
  totalSupervisory: number;
  panelStatus: boolean;
  lastPanelSync: string | null;
  buildingCount: number;
}

/** Sum alarmDetails totals across every *BuildingDB (all buildings / communities). */
export function sumAlarmDetailsFromDb(
  db: Record<string, unknown>,
): StoredPanelAlarmTotals {
  let totalFire = 0;
  let totalTrouble = 0;
  let totalSupervisory = 0;
  let panelStatus = false;
  let lastPanelSync: string | null = null;
  let buildingCount = 0;

  for (const key of Object.keys(db)) {
    if (!key.endsWith("BuildingDB")) continue;
    const alarmDetails = getDocument(db, [key, "alarmDetails"]) as Record<
      string,
      unknown
    > | null;
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

export async function getStoredPanelAlarmTotals(): Promise<StoredPanelAlarmTotals> {
  const db = await readDb();
  return sumAlarmDetailsFromDb(db);
}

/** Sum totalFire from each building's alarmDetails (panel-level previous count). */
export async function getStoredPanelFireCount(): Promise<number> {
  const totals = await getStoredPanelAlarmTotals();
  return totals.totalFire;
}

/** Fingerprint panel lists to skip DB work when nothing changed. */
export function alarmListsFingerprint(alarms: {
  fire: CategoryAlarmResult;
  trouble: CategoryAlarmResult;
  supervisory: CategoryAlarmResult;
}): string {
  return [
    alarms.fire.total,
    alarms.fire.list || "",
    alarms.trouble.total,
    alarms.trouble.list || "",
    alarms.supervisory.total,
    alarms.supervisory.list || "",
  ].join("\x1e");
}

export interface AlarmSyncResult {
  matchedAssets: number;
  buildingsUpdated: string[];
  skipped: boolean;
  messagesAdded?: number;
}

export interface AlarmSyncOptions {
  /** Panel fire count before this poll (for new alarmMessage rows) */
  previousFireCount?: number;
}

/** Human-readable text from a panel list row (no address / status suffix). */
export function formatPanelLineAsMessage(raw: string): string {
  let line = String(raw || "").trim();
  line = line.replace(/^M\d+-\d+(?:-\d+)?\s+/i, "");
  line = line.replace(/\s+[A-Z]{2,6}\*?\s*$/i, "").trim();
  return line;
}

function appendFireAlarmMessages(
  db: Record<string, unknown>,
  index: Map<string, Array<{ id: string; asset: DbAsset }>>,
  fireList: string | null,
  previousFireCount: number,
  newFireCount: number,
  markDirty: () => void,
): number {
  const n = newFireCount - previousFireCount;
  if (n <= 0 || !fireList) return 0;

  const entries = parsePanelListResponse(fireList);
  const newEntries = entries.slice(-n);
  if (newEntries.length === 0) return 0;

  const now = Date.now();
  const rowsByBuilding = new Map<string, Array<{ message: string; time: number }>>();

  for (const entry of newEntries) {
    const message = formatPanelLineAsMessage(entry.raw);
    if (!message) continue;

    const bucket = index.get(entry.deviceAddress);
    const building = bucket?.[0]?.asset ? getBuildingName(bucket[0].asset) : "";
    if (!building) continue;

    if (!rowsByBuilding.has(building)) rowsByBuilding.set(building, []);
    rowsByBuilding.get(building)!.push({ message, time: now });
  }

  let added = 0;

  for (const [building, newRows] of rowsByBuilding) {
    const buildingDb = building.endsWith("BuildingDB")
      ? building
      : `${building}BuildingDB`;
    const existingDoc =
      (getDocument(db, [buildingDb, "alarmMessage"]) as Record<string, unknown>) ||
      {};
    const existing = Array.isArray(existingDoc.alarmMessage)
      ? (existingDoc.alarmMessage as Array<{ message?: string; time?: number }>)
      : [];

    setDocument(
      db,
      [buildingDb, "alarmMessage"],
      {
        ...existingDoc,
        alarmMessage: [...existing, ...newRows],
      },
      false,
    );
    markDirty();
    added += newRows.length;

    serverLog(
      `[fire-panel] ${buildingDb}/alarmMessage +${newRows.length} fire message(s)`,
    );
  }

  return added;
}

function recountCategoryPerBuilding(
  assetsList: AssetsListMap,
  statusKey: StatusKey,
) {
  const counts = new Map<string, number>();

  for (const asset of Object.values(assetsList)) {
    const building = getBuildingName(asset);
    if (!building) continue;

    const status = getSimplexStatus(asset);
    if (Number(status[statusKey]) !== 1) continue;

    counts.set(building, (counts.get(building) || 0) + 1);
  }

  return counts;
}

function applyCategoryListToAssets(
  assetsList: AssetsListMap,
  category: AlarmCategory,
  result: CategoryAlarmResult,
  markDirty: () => void,
) {
  const statusKey = statusKeyForCategory(category);
  let matchedAssets = 0;

  for (const asset of Object.values(assetsList)) {
    const status = getSimplexStatus(asset);
    if (Number(status[statusKey]) !== 0) {
      const resetFlags: Partial<Record<StatusKey, 0 | 1>> = {
        [statusKey]: 0,
      };
      setSimplexFlags(asset, resetFlags);
      markDirty();
    }
  }

  if (!result.list || result.total <= 0) {
    return { matchedAssets, index: buildAddressIndex(assetsList) };
  }

  const index = buildAddressIndex(assetsList);
  const entries = parsePanelListResponse(result.list);
  addLogEntries(category, entries.length);

  for (const entry of entries) {
    const flags = flagsFromLabel(entry.label, category);
    const candidateKeys = [
      ...collectAddressMatchKeys(entry.deviceAddress),
      ...collectAddressMatchKeys(entry.fullAddress),
    ];
    let bucket: Array<{ id: string; asset: DbAsset }> | undefined;
    for (const k of candidateKeys) {
      bucket = index.get(k);
      if (bucket?.length) break;
    }

    if (!bucket?.length) {
      serverLog(
        `[fire-panel] No AssetsList match for deviceAddress ${entry.deviceAddress}`,
      );
      continue;
    }

    for (const { asset } of bucket) {
      const before = getSimplexStatus(asset);
      setSimplexFlags(asset, {
        F: flags.F ?? (Number(before.F) as 0 | 1),
        T: flags.T ?? (Number(before.T) as 0 | 1),
        S: flags.S ?? (Number(before.S) as 0 | 1),
      });
      const after = getSimplexStatus(asset);
      if (
        before.F !== after.F ||
        before.T !== after.T ||
        before.S !== after.S
      ) {
        markDirty();
      }
      matchedAssets++;
    }
  }

  return { matchedAssets, index };
}

/**
 * Sync one alarm category (fire / trouble / supervisory) to AssetsList and
 * update the matching total* field in each building's alarmDetails.
 */
export async function syncSingleCategoryPanelAlarmsToDatabase(
  category: AlarmCategory,
  result: CategoryAlarmResult,
  options: AlarmSyncOptions = {},
): Promise<AlarmSyncResult> {
  return withDbMutate((db, { markDirty }) => {
    const assetsList = getAssetsList(db);
    if (Object.keys(assetsList).length === 0) {
      return { matchedAssets: 0, buildingsUpdated: [] as string[], skipped: true };
    }

    const statusKey = statusKeyForCategory(category);
    const { matchedAssets, index } = applyCategoryListToAssets(
      assetsList,
      category,
      result,
      markDirty,
    );

    const buildingCounts = recountCategoryPerBuilding(assetsList, statusKey);
    const buildingsWithAssets = collectBuildingsWithAssets(assetsList);
    updateBuildingCategoryTotal(
      db,
      category,
      buildingCounts,
      buildingsWithAssets,
      markDirty,
    );

    let messagesAdded = 0;
    if (category === "fire" && options.previousFireCount !== undefined) {
      messagesAdded = appendFireAlarmMessages(
        db,
        index,
        result.list,
        options.previousFireCount,
        result.total,
        markDirty,
      );
    }

    return {
      matchedAssets,
      buildingsUpdated: [...buildingsWithAssets],
      skipped: false,
      messagesAdded,
    };
  });
}

function mergeAlarmSyncResults(results: AlarmSyncResult[]): AlarmSyncResult {
  const buildingsUpdated = new Set<string>();
  let matchedAssets = 0;
  let messagesAdded = 0;
  let skipped = true;

  for (const result of results) {
    if (!result.skipped) skipped = false;
    matchedAssets += result.matchedAssets;
    messagesAdded += result.messagesAdded ?? 0;
    for (const building of result.buildingsUpdated) {
      buildingsUpdated.add(building);
    }
  }

  return {
    matchedAssets,
    buildingsUpdated: [...buildingsUpdated],
    skipped,
    messagesAdded: messagesAdded > 0 ? messagesAdded : undefined,
  };
}

/**
 * Apply fire/trouble/supervisory lists to AssetsList and building alarmDetails.
 */
export async function syncPanelAlarmsToDatabase(
  value: {
    label: AlarmCategory;
    category: CategoryAlarmResult
  },
  options: AlarmSyncOptions = {},
): Promise<AlarmSyncResult> {
  return syncSingleCategoryPanelAlarmsToDatabase(
    value.label,
    value.category,
    options,
  );
}

function addLogEntries(category: AlarmCategory, count: number) {
  serverLog(`[fire-panel] Parsed ${count} ${category} list row(s)`);
}
