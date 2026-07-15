import { clientMainRoute } from "@/config/role-routes";
import { normalizeBuildingName } from "@/lib/buildingNames";
import { findCommunityIdForBuilding } from "@/lib/fireAlertFloorNavigation";

const STORAGE_KEY = "vision365.graphicsViewSelection";

export function readGraphicsViewSelection() {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const building = normalizeBuildingName(parsed?.building || "");
    if (!building) return null;
    return {
      communityId: String(parsed?.communityId || ""),
      building,
    };
  } catch {
    return null;
  }
}

export function saveGraphicsViewSelection({ communityId, building }) {
  if (typeof window === "undefined") return;
  const normalizedBuilding = normalizeBuildingName(building || "");
  if (!normalizedBuilding) return;
  sessionStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      communityId: String(communityId || ""),
      building: normalizedBuilding,
    }),
  );
}

export function buildingExistsInCommunities(communities, buildingName) {
  const normalized = normalizeBuildingName(buildingName);
  if (!normalized) return false;
  return (communities || []).some((community) =>
    (community.buildings || []).some(
      (building) => normalizeBuildingName(building) === normalized,
    ),
  );
}

/** Match a building hint to the exact value used in community.buildings / Select items. */
export function findBuildingListValue(buildings = [], buildingName = "") {
  const normalized = normalizeBuildingName(buildingName);
  if (!normalized) return "";

  for (const building of buildings) {
    const value =
      typeof building === "string" ? building : normalizeBuildingName(building);
    if (normalizeBuildingName(value) === normalized) {
      return value;
    }
  }

  return "";
}

export function resolveSelectionForCommunity(communities, communityId, buildingHint = "") {
  const community = (communities || []).find((entry) => entry.id === communityId);
  const buildingList = community?.buildings || [];
  if (!community || buildingList.length === 0) return null;

  const building =
    findBuildingListValue(buildingList, buildingHint) ||
    (buildingList.length === 1
      ? findBuildingListValue(buildingList, buildingList[0])
      : "");

  if (!building) return null;
  return { communityId: community.id, building };
}

/** Pick the best community + building to open in Graphics View. */
export function resolveGraphicsViewSelection({
  communities = [],
  selectedCommunity = "",
  selectedBuilding = "",
  allBuildings = [],
}) {
  if (selectedBuilding && buildingExistsInCommunities(communities, selectedBuilding)) {
    const communityId =
      selectedCommunity ||
      findCommunityIdForBuilding(communities, selectedBuilding);
    return (
      resolveSelectionForCommunity(communities, communityId, selectedBuilding) || {
        communityId,
        building: findBuildingListValue(
          communities.find((c) => c.id === communityId)?.buildings || [],
          selectedBuilding,
        ),
      }
    );
  }

  const stored = readGraphicsViewSelection();
  if (stored?.building && buildingExistsInCommunities(communities, stored.building)) {
    const communityId =
      stored.communityId ||
      findCommunityIdForBuilding(communities, stored.building);
    return (
      resolveSelectionForCommunity(communities, communityId, stored.building) || {
        communityId,
        building: stored.building,
      }
    );
  }

  if (allBuildings?.length === 1) {
    const buildingHint = normalizeBuildingName(
      allBuildings[0]?.name || allBuildings[0]?.buildingName || "",
    );
    const communityId = findCommunityIdForBuilding(communities, buildingHint);
    if (buildingHint && communityId) {
      return resolveSelectionForCommunity(communities, communityId, buildingHint);
    }
  }

  const firstCommunity = communities[0];
  if (firstCommunity?.id) {
    return resolveSelectionForCommunity(communities, firstCommunity.id);
  }

  return null;
}

export function parseGraphicsViewSelectionParams(searchParams) {
  const buildingHint = normalizeBuildingName(searchParams?.get("building") || "");
  if (!buildingHint) return null;

  return {
    building: buildingHint,
    communityId: String(searchParams?.get("community") || ""),
  };
}

export function buildGraphicsViewUrl({ communityId, building } = {}) {
  const normalizedBuilding = normalizeBuildingName(building || "");
  if (!normalizedBuilding) return clientMainRoute;

  const params = new URLSearchParams();
  params.set("building", normalizedBuilding);
  if (communityId) params.set("community", String(communityId));

  return `${clientMainRoute}?${params.toString()}`;
}
