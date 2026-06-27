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
  await withDbMutate((db, { markDirty }) => {
    const existing =
      (getDocument(db, [PANEL_STATE_DOC]) as Record<string, unknown>) || {};
    const totalField = totalFieldForCategory(category);
    console.log({ totalField })
    const now = new Date().toISOString();

    if (Number(existing[totalField]) === count) return;

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
    markDirty();

    serverLog(
      `[fire-panel] firePanelState → ${totalField}=${count} (previous panel count)`,
    );
  });
}

/** Persist all three CVAL totals to firePanelState (e.g. after monitor cycle). */
export async function savePanelStateCounts(counts: {
  totalFire: number;
  totalTrouble: number;
  totalSupervisory: number;
}): Promise<PanelCategoryCounts & { unchanged?: boolean }> {
  let result: PanelCategoryCounts & { unchanged?: boolean };

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
    markDirty();

    const changes: string[] = [];
    if (existing.totalFire !== next.totalFire) {
      changes.push(`fire ${existing.totalFire}→${next.totalFire}`);
    }
    if (existing.totalSupervisory !== next.totalSupervisory) {
      changes.push(`supervisory ${existing.totalSupervisory}→${next.totalSupervisory}`);
    }
    if (existing.totalTrouble !== next.totalTrouble) {
      changes.push(`trouble ${existing.totalTrouble}→${next.totalTrouble}`);
    }
    if (changes.length > 0) {
      serverLog(`[fire-panel] firePanelState → ${changes.join(", ")}`);
    }

    result = payload;
  });

  return result!;
}

export interface PanelListEntry {
  deviceAddress: string;
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

    const addressMatch = trimmed.match(/^(M\d+-\d+(?:-\d+)?)(?:\s+|$)/i);
    if (!addressMatch) continue;

    const deviceAddress = addressMatch[1].toUpperCase();
    const labelMatch = trimmed.match(/\s([A-Z]{2,6})\*?\s*$/i);
    const label = (labelMatch?.[1] || "").toUpperCase();

    entries.push({ deviceAddress, label, raw: trimmed });
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

function buildAddressIndex(assetsList: AssetsListMap) {
  const index = new Map<string, Array<{ id: string; asset: DbAsset }>>();

  for (const [id, asset] of Object.entries(assetsList)) {
    const addr = getAssetDeviceAddress(asset);
    if (!addr) continue;
    const bucket = index.get(addr) || [];
    bucket.push({ id, asset });
    index.set(addr, bucket);
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
    const bucket = index.get(entry.deviceAddress);

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
