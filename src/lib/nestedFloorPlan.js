/**
 * Nested floor plan hierarchy:
 * Building overview -> Floor map -> Section map -> Subsection map (assets)
 */

export const NAV_LEVELS = {
  BUILDING: "building",
  FLOOR: "floor",
  SECTION: "section",
  SUBSECTION: "subsection",
};

/** Sanitize a string for use as a Firestore document id. */
export function sanitizeFloorPlanId(value) {
  return String(value || "")
    .trim()
    .replace(/[\/\\]/g, "_")
    .replace(/[()]/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .substring(0, 100);
}

export function buildingCollectionName(buildingName) {
  const name = String(buildingName || "").trim();
  return name.endsWith("BuildingDB") ? name : `${name}BuildingDB`;
}

export function createMarkerId(name) {
  return `${sanitizeFloorPlanId(name)}_${Date.now()}`;
}

/** True when a nav marker has been placed on a plan image. */
export function isNavMarkerPlaced(marker) {
  if (!marker) return false;
  const hasAbsolute =
    typeof marker.x === "number" && typeof marker.y === "number";
  const hasRelative =
    typeof marker.relativeX === "number" && typeof marker.relativeY === "number";
  return hasAbsolute || hasRelative;
}

/** Keep only markers that have coordinates on the plan. */
export function filterPlacedNavMarkers(markers = []) {
  return markers.filter(isNavMarkerPlaced);
}

export function findSectionMarker(sectionMarkers, sectionId) {
  return (sectionMarkers || []).find((m) => m.sectionId === sectionId);
}

export function findSubsectionMarker(subsectionMarkers, subsectionId) {
  return (subsectionMarkers || []).find((m) => m.subsectionId === subsectionId);
}

/** Convert click position on displayed image to natural image coordinates. */
export function clickToNaturalCoords(event, imageRef, actualImageDimensions) {
  if (!imageRef.current || !actualImageDimensions.naturalWidth) return null;

  const rect = imageRef.current.getBoundingClientRect();
  const clientX = event.clientX ?? event.changedTouches?.[0]?.clientX;
  const clientY = event.clientY ?? event.changedTouches?.[0]?.clientY;
  if (clientX == null || clientY == null) return null;

  const clickX = clientX - rect.left - actualImageDimensions.offsetX;
  const clickY = clientY - rect.top - actualImageDimensions.offsetY;

  if (
    clickX < 0 ||
    clickY < 0 ||
    clickX > actualImageDimensions.width ||
    clickY > actualImageDimensions.height
  ) {
    return null;
  }

  const x = Math.round(
    (clickX / actualImageDimensions.width) * actualImageDimensions.naturalWidth,
  );
  const y = Math.round(
    (clickY / actualImageDimensions.height) * actualImageDimensions.naturalHeight,
  );
  const relativeX = clickX / actualImageDimensions.width;
  const relativeY = clickY / actualImageDimensions.height;

  return { x, y, relativeX, relativeY };
}

/** Convert natural image coordinates to screen position for marker overlay. */
export function naturalToScreenCoords(marker, actualImageDimensions) {
  const { naturalWidth, naturalHeight, width, height, offsetX, offsetY } =
    actualImageDimensions;

  if (!naturalWidth || !naturalHeight) {
    return { left: 0, top: 0 };
  }

  if (typeof marker.relativeX === "number" && typeof marker.relativeY === "number") {
    return {
      left: marker.relativeX * width + offsetX,
      top: marker.relativeY * height + offsetY,
    };
  }

  return {
    left: (marker.x / naturalWidth) * width + offsetX,
    top: (marker.y / naturalHeight) * height + offsetY,
  };
}

export function calculateDisplayedImageDimensions(img) {
  const containerRect = img.getBoundingClientRect();
  const containerWidth = containerRect.width;
  const containerHeight = containerRect.height;
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;

  const scale = Math.min(containerWidth / naturalWidth, containerHeight / naturalHeight);
  const displayedWidth = naturalWidth * scale;
  const displayedHeight = naturalHeight * scale;

  return {
    width: displayedWidth,
    height: displayedHeight,
    offsetX: (containerWidth - displayedWidth) / 2,
    offsetY: (containerHeight - displayedHeight) / 2,
    naturalWidth,
    naturalHeight,
  };
}

/** Breadcrumb trail for nested navigation. */
export function buildBreadcrumbs(level, { buildingName, floor, section, subsection }) {
  const crumbs = [{ level: NAV_LEVELS.BUILDING, label: buildingName || "Building" }];

  if (level === NAV_LEVELS.BUILDING) return crumbs;

  crumbs.push({ level: NAV_LEVELS.FLOOR, label: floor?.name || "Floor", id: floor?.id });

  if (level === NAV_LEVELS.FLOOR) return crumbs;

  crumbs.push({
    level: NAV_LEVELS.SECTION,
    label: section?.name || "Section",
    id: section?.id,
  });

  if (level === NAV_LEVELS.SECTION) return crumbs;

  crumbs.push({
    level: NAV_LEVELS.SUBSECTION,
    label: subsection?.name || "Subsection",
    id: subsection?.id,
  });

  return crumbs;
}

/**
 * Hierarchy metadata attached to every asset placed on a nested floor plan.
 */
export function buildNestedPlacementContext({
  buildingName,
  floor,
  section,
  subsection = null,
  placementLevel,
}) {
  const floorName = floor?.name || "";
  const sectionName = section?.name || "";
  const subsectionName = subsection?.name || "";
  const level = placementLevel || (subsection ? "subsection" : "section");

  const pathParts = [buildingName, floorName, sectionName];
  if (level === "subsection" && subsectionName) pathParts.push(subsectionName);
  const nestedPath = pathParts.filter(Boolean).join(" > ");

  const planParts = [floorName, sectionName];
  if (level === "subsection" && subsectionName) planParts.push(subsectionName);
  const floorPlanName = planParts.filter(Boolean).join(" / ");

  return {
    buildingName: buildingName || "",
    building: buildingName || "",
    placementLevel: level,
    nestedPath,
    floorPlanName,
    floorMapName: floorPlanName,
    floorId: floor?.id || "",
    floorName,
    floorImageUrl: floor?.imageUrl || "",
    sectionId: section?.id || "",
    sectionName,
    sectionImageUrl: section?.imageUrl || "",
    subsectionId: subsection?.id || "",
    subsectionName,
    subsectionImageUrl: subsection?.imageUrl || "",
    floorDetails: floor
      ? { id: floor.id, name: floor.name, imageUrl: floor.imageUrl || "", order: floor.order }
      : null,
    sectionDetails: section
      ? { id: section.id, name: section.name, imageUrl: section.imageUrl || "" }
      : null,
    subsectionDetails:
      subsection && level === "subsection"
        ? { id: subsection.id, name: subsection.name, imageUrl: subsection.imageUrl || "" }
        : null,
  };
}

/** Build overlay markers for floors on the building overview image. */
export function buildBuildingFloorMarkers(floors = []) {
  const sorted = [...floors].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const count = sorted.length;

  return sorted.map((floor, index) => {
    const hasRelative =
      typeof floor.relativeX === "number" && typeof floor.relativeY === "number";

    if (hasRelative) {
      return {
        id: floor.id,
        floorId: floor.id,
        name: floor.name,
        x: floor.x,
        y: floor.y,
        relativeX: floor.relativeX,
        relativeY: floor.relativeY,
      };
    }

    if (typeof floor.x === "number" && typeof floor.y === "number") {
      return {
        id: floor.id,
        floorId: floor.id,
        name: floor.name,
        x: floor.x,
        y: floor.y,
        relativeX: floor.relativeX,
        relativeY: floor.relativeY,
      };
    }

    // Default: spread floors vertically on the building image
    return {
      id: floor.id,
      floorId: floor.id,
      name: floor.name,
      relativeX: 0.5,
      relativeY: count <= 1 ? 0.5 : (index + 1) / (count + 1),
    };
  });
}
