import { normalizeBuildingName } from "@/lib/buildingNames";

const FLOOR_PLAN_VIEW_PATH = "/dashboard/floor_configuration/view";

/** Extract nested floor-plan navigation ids from a fire device record. */
export function getFireDeviceNavigationTarget(device) {
  if (!device) return null;

  const building = normalizeBuildingName(
    device.buildingName || device.building || "",
  );
  const floorId = device.floorId || device.floorDetails?.id || "";
  const sectionId = device.sectionId || device.sectionDetails?.id || "";
  const subsectionId = device.subsectionId || device.subsectionDetails?.id || "";
  const placementLevel =
    device.placementLevel || (subsectionId ? "subsection" : "section");

  if (!building || !floorId || !sectionId) return null;

  return {
    building,
    floorId,
    sectionId,
    subsectionId: placementLevel === "subsection" ? subsectionId : "",
    assetId: device.assetId || device.id || "",
  };
}

/** Build the graphics view URL for a fire device on a nested floor plan. */
export function buildFloorPlanViewUrl(target) {
  if (!target?.building || !target?.floorId || !target?.sectionId) {
    return FLOOR_PLAN_VIEW_PATH;
  }

  const params = new URLSearchParams();
  params.set("building", target.building);
  params.set("floor", target.floorId);
  params.set("section", target.sectionId);
  if (target.subsectionId) params.set("subsection", target.subsectionId);
  if (target.assetId) params.set("assetId", target.assetId);

  return `${FLOOR_PLAN_VIEW_PATH}?${params.toString()}`;
}

export function parseFloorPlanViewSearchParams(searchParams) {
  const building = searchParams?.get("building") || "";
  const floorId = searchParams?.get("floor") || "";
  const sectionId = searchParams?.get("section") || "";
  const subsectionId = searchParams?.get("subsection") || "";
  const assetId = searchParams?.get("assetId") || "";

  if (!building || !floorId || !sectionId) return null;

  return {
    building: normalizeBuildingName(building),
    floorId,
    sectionId,
    subsectionId,
    assetId,
  };
}

/** Find the community id that contains the given building name. */
export function findCommunityIdForBuilding(communities, buildingName) {
  const normalized = normalizeBuildingName(buildingName);
  if (!normalized) return "";

  for (const community of communities || []) {
    const hasBuilding = (community.buildings || []).some(
      (b) => normalizeBuildingName(b) === normalized,
    );
    if (hasBuilding) return community.id;
  }

  return "";
}
