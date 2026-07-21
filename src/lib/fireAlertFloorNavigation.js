import { normalizeBuildingName } from "@/lib/buildingNames";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

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
    // Prefer Firestore doc id — human-readable assetId often does not match marker ids.
    assetId: device.id || device.assetsListId || device.assetId || "",
    // Address is the reliable match key when mapping doc ids differ from AssetsList ids.
    address: resolveAssetDeviceAddress(device) || "",
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
  if (target.address) params.set("address", target.address);
  // Only the asset search bar should request the orange "Found" highlight.
  if (target.highlight) params.set("highlight", "1");

  return `${FLOOR_PLAN_VIEW_PATH}?${params.toString()}`;
}

export function parseFloorPlanViewSearchParams(searchParams) {
  const building = searchParams?.get("building") || "";
  const floorId = searchParams?.get("floor") || "";
  const sectionId = searchParams?.get("section") || "";
  const subsectionId = searchParams?.get("subsection") || "";
  const assetId = searchParams?.get("assetId") || "";
  const address = searchParams?.get("address") || "";
  const highlight = searchParams?.get("highlight") === "1";
  const nav = searchParams?.get("nav") || "";

  if (!building || !floorId || !sectionId) return null;

  return {
    building: normalizeBuildingName(building),
    floorId,
    sectionId,
    subsectionId,
    assetId,
    address,
    highlight,
    nav,
  };
}

/** True when a floor-plan URL already includes building + floor + section. */
export function floorPlanUrlHasPlacement(url = "") {
  try {
    const parsed = new URL(String(url || ""), "http://local");
    return Boolean(
      parsed.searchParams.get("building") &&
        parsed.searchParams.get("floor") &&
        parsed.searchParams.get("section"),
    );
  } catch {
    return false;
  }
}

/**
 * Stamp asset search keys onto a floor-plan URL.
 * Always sets a fresh `nav` token so Graphics View re-applies the deep link.
 */
export function stampFloorPlanNavigationParams(
  url = "",
  { assetId = "", address = "", highlight = false } = {},
) {
  const parsed = new URL(
    String(url || FLOOR_PLAN_VIEW_PATH),
    typeof window !== "undefined" ? window.location.origin : "http://local",
  );
  if (assetId) parsed.searchParams.set("assetId", assetId);
  if (address) parsed.searchParams.set("address", address);
  if (highlight) parsed.searchParams.set("highlight", "1");
  else parsed.searchParams.delete("highlight");
  // Unique token so repeating the same search still triggers navigation effects.
  parsed.searchParams.set("nav", `${Date.now()}`);
  return `${parsed.pathname}?${parsed.searchParams.toString()}`;
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
