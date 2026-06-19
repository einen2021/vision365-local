/** Community-building assignment logic (ported from src/lib/communityBuildings.js) */

type DbRecord = Record<string, unknown>;

function normalizeBuildingName(name: string): string {
  return String(name || "").trim();
}

export function getBuildingDbKeys(db: DbRecord): string[] {
  return Object.keys(db).filter(
    (key) => key.endsWith("BuildingDB") && typeof db[key] === "object"
  );
}

export function toShortName(buildingDbKey: string): string {
  return buildingDbKey.replace(/BuildingDB$/i, "");
}

export function toDbKey(shortName: string): string {
  const clean = normalizeBuildingName(shortName);
  return clean.endsWith("BuildingDB") ? clean : `${clean}BuildingDB`;
}

export function getAssignedBuildingSet(db: DbRecord): Set<string> {
  const assigned = new Set<string>();
  const communities = (db.communities || {}) as Record<string, { buildings?: string[] }>;
  Object.values(communities).forEach((c) => {
    (c.buildings || []).forEach((b) => assigned.add(normalizeBuildingName(b)));
  });
  return assigned;
}

export function listAllBuildingsWithStatus(db: DbRecord) {
  const communities = (db.communities || {}) as Record<
    string,
    { buildings?: string[]; communityName?: string; name?: string }
  >;
  const buildingToCommunity = new Map<
    string,
    { communityId: string; communityName: string }
  >();

  Object.entries(communities).forEach(([id, c]) => {
    (c.buildings || []).forEach((b) => {
      const short = normalizeBuildingName(b);
      buildingToCommunity.set(short, {
        communityId: id,
        communityName: c.communityName || c.name || id,
      });
    });
  });

  return getBuildingDbKeys(db).map((key) => {
    const short = toShortName(key);
    const match = buildingToCommunity.get(short);
    return {
      buildingName: short,
      buildingDbKey: key,
      communityId: match?.communityId || null,
      communityName: match?.communityName || null,
      isAssigned: Boolean(match),
    };
  });
}

export function listUnassignedBuildings(db: DbRecord) {
  const assigned = getAssignedBuildingSet(db);
  return getBuildingDbKeys(db)
    .map((key) => toShortName(key))
    .filter((short) => !assigned.has(short))
    .map((buildingName) => ({ buildingName }));
}

export function getCommunityBuildingsList(db: DbRecord, communityId: string) {
  const communities = db.communities as Record<string, { buildings?: string[] }> | undefined;
  const community = communities?.[communityId];
  if (!community) return [];
  return (community.buildings || []).map((b) => ({
    buildingName: normalizeBuildingName(b),
  }));
}

export function assignBuildingsToCommunity(
  db: DbRecord,
  communityId: string,
  buildingNames: string[],
  updatedBy?: string
) {
  const communities = db.communities as Record<
    string,
    { buildings?: string[]; totalBuildings?: number; updatedAt?: string; updatedBy?: string }
  >;
  const community = communities?.[communityId];
  if (!community) {
    return { status: false, message: "Community not found" };
  }

  const current = new Set(
    (community.buildings || []).map((b) => normalizeBuildingName(b)).filter(Boolean)
  );

  for (const name of buildingNames) {
    const short = normalizeBuildingName(name);
    if (!short) continue;
    const dbKey = toDbKey(short);
    if (!db[dbKey]) {
      return { status: false, message: `Building not found: ${short}` };
    }
    Object.entries(communities || {}).forEach(([id, c]) => {
      if (id === communityId) return;
      c.buildings = (c.buildings || []).filter(
        (b) => normalizeBuildingName(b) !== short
      );
      c.totalBuildings = c.buildings.length;
    });
    current.add(short);
  }

  community.buildings = [...current];
  community.totalBuildings = community.buildings.length;
  community.updatedAt = new Date().toISOString();
  community.updatedBy = updatedBy || "system";

  return {
    status: true,
    message: `Assigned ${buildingNames.length} building(s)`,
    buildings: community.buildings,
  };
}

export function removeBuildingsFromCommunity(
  db: DbRecord,
  communityId: string,
  buildingNames: string[],
  updatedBy?: string
) {
  const communities = db.communities as Record<
    string,
    { buildings?: string[]; totalBuildings?: number; updatedAt?: string; updatedBy?: string }
  >;
  const community = communities?.[communityId];
  if (!community) {
    return { status: false, message: "Community not found" };
  }

  const removeSet = new Set(buildingNames.map((b) => normalizeBuildingName(b)));
  community.buildings = (community.buildings || []).filter(
    (b) => !removeSet.has(normalizeBuildingName(b))
  );
  community.totalBuildings = community.buildings.length;
  community.updatedAt = new Date().toISOString();
  community.updatedBy = updatedBy || "system";

  return {
    status: true,
    message: `Removed ${buildingNames.length} building(s)`,
    buildings: community.buildings,
  };
}
