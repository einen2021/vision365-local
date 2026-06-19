import { normalizeBuildingName } from "@/lib/buildingNames";

/** Top-level keys in db.json that represent buildings */
export function getBuildingDbKeys(db) {
  return Object.keys(db).filter(
    (key) => key.endsWith("BuildingDB") && typeof db[key] === "object",
  );
}

export function toShortName(buildingDbKey) {
  return buildingDbKey.replace(/BuildingDB$/i, "");
}

export function toDbKey(shortName) {
  const clean = normalizeBuildingName(shortName);
  return clean.endsWith("BuildingDB") ? clean : `${clean}BuildingDB`;
}

/** All buildings assigned to any community */
export function getAssignedBuildingSet(db) {
  const assigned = new Set();
  const communities = db.communities || {};
  Object.values(communities).forEach((c) => {
    (c.buildings || []).forEach((b) => assigned.add(normalizeBuildingName(b)));
  });
  return assigned;
}

export function listAllBuildingsWithStatus(db) {
  const communities = db.communities || {};
  const buildingToCommunity = new Map();

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

export function listUnassignedBuildings(db) {
  const assigned = getAssignedBuildingSet(db);
  return getBuildingDbKeys(db)
    .map((key) => toShortName(key))
    .filter((short) => !assigned.has(short))
    .map((buildingName) => ({ buildingName }));
}

export function getCommunityBuildingsList(db, communityId) {
  const community = db.communities?.[communityId];
  if (!community) return [];
  return (community.buildings || []).map((b) => ({
    buildingName: normalizeBuildingName(b),
  }));
}

export function assignBuildingsToCommunity(db, communityId, buildingNames, updatedBy) {
  const community = db.communities?.[communityId];
  if (!community) {
    return { status: false, message: "Community not found" };
  }

  const current = new Set(
    (community.buildings || []).map((b) => normalizeBuildingName(b)).filter(Boolean),
  );

  for (const name of buildingNames) {
    const short = normalizeBuildingName(name);
    if (!short) continue;
    const dbKey = toDbKey(short);
    if (!db[dbKey]) {
      return { status: false, message: `Building not found: ${short}` };
    }
    // Remove from other communities first
    Object.entries(db.communities || {}).forEach(([id, c]) => {
      if (id === communityId) return;
      c.buildings = (c.buildings || []).filter(
        (b) => normalizeBuildingName(b) !== short,
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

export function removeBuildingsFromCommunity(db, communityId, buildingNames, updatedBy) {
  const community = db.communities?.[communityId];
  if (!community) {
    return { status: false, message: "Community not found" };
  }

  const removeSet = new Set(buildingNames.map((b) => normalizeBuildingName(b)));
  community.buildings = (community.buildings || []).filter(
    (b) => !removeSet.has(normalizeBuildingName(b)),
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
