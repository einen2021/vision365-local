/**
 * Match panel list output to AssetsList devices and update building alarmDetails.
 *
 * Example list line:
 * M1-3       P1/L1/2B/CAR PARK/3    SMOKE DETECTOR    TRBL*
 */

import { getDocument, setDocument, withDbMutate } from "../db/documentStore";
import { serverLog } from "../log";

export type AlarmCategory = "fire" | "trouble" | "supervisory";

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

function recountBuildingAlarms(assetsList: AssetsListMap) {
  const counts = new Map<
    string,
    { fire: number; trouble: number; supervisory: number }
  >();

  for (const asset of Object.values(assetsList)) {
    const building = getBuildingName(asset);
    if (!building) continue;

    if (!counts.has(building)) {
      counts.set(building, { fire: 0, trouble: 0, supervisory: 0 });
    }

    const bucket = counts.get(building)!;
    const status = getSimplexStatus(asset);
    if (Number(status.F) === 1) bucket.fire++;
    if (Number(status.T) === 1) bucket.trouble++;
    if (Number(status.S) === 1) bucket.supervisory++;
  }

  return counts;
}

function updateBuildingAlarmDetails(
  db: Record<string, unknown>,
  buildingCounts: Map<
    string,
    { fire: number; trouble: number; supervisory: number }
  >,
  markDirty: () => void,
) {
  const now = new Date().toISOString();

  for (const [building, counts] of buildingCounts) {
    const buildingDb = building.endsWith("BuildingDB")
      ? building
      : `${building}BuildingDB`;
    const existing =
      (getDocument(db, [buildingDb, "alarmDetails"]) as Record<
        string,
        unknown
      >) || {};

    const next = {
      ...existing,
      totalFire: counts.fire,
      totalTrouble: counts.trouble,
      totalSupervisory: counts.supervisory,
      panelStatus: true,
      lastPanelSync: now,
    };

    const unchanged =
      Number(existing.totalFire) === counts.fire &&
      Number(existing.totalTrouble) === counts.trouble &&
      Number(existing.totalSupervisory) === counts.supervisory &&
      existing.panelStatus === true;

    if (unchanged) continue;

    setDocument(db, [buildingDb, "alarmDetails"], next, true);
    markDirty();

    serverLog(
      `[fire-panel] ${buildingDb} alarmDetails → fire=${counts.fire} trouble=${counts.trouble} supervisory=${counts.supervisory}`,
    );
  }
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

/**
 * Apply fire/trouble/supervisory lists to AssetsList and building alarmDetails.
 */
export async function syncPanelAlarmsToDatabase(
  alarms: {
    fire: CategoryAlarmResult;
    trouble: CategoryAlarmResult;
    supervisory: CategoryAlarmResult;
  },
  options: AlarmSyncOptions = {},
): Promise<AlarmSyncResult> {
  return withDbMutate((db, { markDirty }) => {
    const assetsList = getAssetsList(db);
    if (Object.keys(assetsList).length === 0) {
      return { matchedAssets: 0, buildingsUpdated: [] as string[], skipped: true };
    }

    let matchedAssets = 0;

    // Reset panel flags in one pass (not per-address scan)
    for (const asset of Object.values(assetsList)) {
      const status = getSimplexStatus(asset);
      if (Number(status.F) !== 0 || Number(status.T) !== 0 || Number(status.S) !== 0) {
        setSimplexFlags(asset, { F: 0, T: 0, S: 0 });
        markDirty();
      }
    }

    const index = buildAddressIndex(assetsList);

    const categories: Array<{
      category: AlarmCategory;
      result: CategoryAlarmResult;
    }> = [
      { category: "fire", result: alarms.fire },
      { category: "trouble", result: alarms.trouble },
      { category: "supervisory", result: alarms.supervisory },
    ];

    for (const { category, result } of categories) {
      if (!result.list || result.total <= 0) continue;

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
    }

    const buildingCounts = recountBuildingAlarms(assetsList);
    updateBuildingAlarmDetails(db, buildingCounts, markDirty);

    let messagesAdded = 0;
    if (options.previousFireCount !== undefined) {
      messagesAdded = appendFireAlarmMessages(
        db,
        index,
        alarms.fire.list,
        options.previousFireCount,
        alarms.fire.total,
        markDirty,
      );
    }

    return {
      matchedAssets,
      buildingsUpdated: [...buildingCounts.keys()],
      skipped: false,
      messagesAdded,
    };
  });
}

function addLogEntries(category: AlarmCategory, count: number) {
  serverLog(`[fire-panel] Parsed ${count} ${category} list row(s)`);
}
