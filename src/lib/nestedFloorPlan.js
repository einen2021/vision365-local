/**
 * Nested floor plan hierarchy:
 * Building overview -> Floor map -> Section map -> Subsection map (assets)
 */

export const NAV_LEVELS = {
  BUILDING: "building",
  FLOOR: "floor",
  SECTION: "section",
  SUBSECTION: "subsection",
  DEVICE_GUIDE: "device_guide",
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
  const clientX = event.clientX ?? event.changedTouches?.[0]?.clientX;
  const clientY = event.clientY ?? event.changedTouches?.[0]?.clientY;
  if (clientX == null || clientY == null) return null;
  return clientPointToNaturalCoords(
    clientX,
    clientY,
    imageRef,
    actualImageDimensions,
  );
}

/** Convert a screen point to natural / relative image coordinates. */
export function clientPointToNaturalCoords(
  clientX,
  clientY,
  imageRef,
  actualImageDimensions,
) {
  if (!imageRef?.current || !actualImageDimensions?.naturalWidth) return null;

  const rect = imageRef.current.getBoundingClientRect();
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

/** Screen position (within image element) for a pointer point, clamped to the plan image. */
export function clientPointToMarkerScreenPos(clientX, clientY, imageRef, dims) {
  if (!imageRef?.current || !dims?.width) return null;

  const rect = imageRef.current.getBoundingClientRect();
  const clickX = clientX - rect.left - dims.offsetX;
  const clickY = clientY - rect.top - dims.offsetY;
  const clampedX = Math.min(dims.width, Math.max(0, clickX));
  const clampedY = Math.min(dims.height, Math.max(0, clickY));

  return {
    left: clampedX + dims.offsetX,
    top: clampedY + dims.offsetY,
  };
}

/** Min/max x/y from a list of coordinate points. */
export function computeCoordinateBounds(points = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of points) {
    const x = typeof point?.x === "number" ? point.x : Number(point?.x);
    const y = typeof point?.y === "number" ? point.y : Number(point?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/**
 * Map CSV / DXF x,y into image-relative placement (0–1) and natural pixel coords.
 * When CSV extents exceed the image, normalizes using the CSV bounding box.
 * DXF uses Y-up; images use Y-down — flipY converts between them (default: true).
 */
export function csvCoordsToRelativePlacement(x, y, options = {}) {
  const {
    bounds = null,
    imageNaturalWidth = 0,
    imageNaturalHeight = 0,
    flipY = true,
  } = options;
  const rawX = typeof x === "number" ? x : Number(x);
  const rawY = typeof y === "number" ? y : Number(y);
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;

  const hasImage = imageNaturalWidth > 0 && imageNaturalHeight > 0;
  const hasBounds = bounds && Number.isFinite(bounds.minX);
  let relativeX;
  let relativeY;

  if (hasImage && hasBounds) {
    const fitsImage =
      bounds.minX >= 0 &&
      bounds.minY >= 0 &&
      bounds.maxX <= imageNaturalWidth &&
      bounds.maxY <= imageNaturalHeight;

    if (fitsImage) {
      relativeX = rawX / imageNaturalWidth;
      relativeY = rawY / imageNaturalHeight;
    } else {
      const spanX = bounds.maxX - bounds.minX || 1;
      const spanY = bounds.maxY - bounds.minY || 1;
      relativeX = (rawX - bounds.minX) / spanX;
      relativeY = (rawY - bounds.minY) / spanY;
    }
  } else if (hasBounds) {
    const spanX = bounds.maxX - bounds.minX || 1;
    const spanY = bounds.maxY - bounds.minY || 1;
    relativeX = (rawX - bounds.minX) / spanX;
    relativeY = (rawY - bounds.minY) / spanY;
  } else if (hasImage) {
    relativeX = rawX / imageNaturalWidth;
    relativeY = rawY / imageNaturalHeight;
  } else {
    return null;
  }

  relativeX = Math.min(1, Math.max(0, relativeX));
  relativeY = Math.min(1, Math.max(0, relativeY));

  // DXF / CAD exports: origin bottom-left, Y increases upward.
  // HTML images: origin top-left, Y increases downward.
  if (flipY) {
    relativeY = 1 - relativeY;
  }

  return {
    relativeX,
    relativeY,
    x: hasImage ? Math.round(relativeX * imageNaturalWidth) : Math.round(rawX),
    y: hasImage ? Math.round(relativeY * imageNaturalHeight) : Math.round(rawY),
  };
}

/** Load natural pixel size of a floor-plan image (browser / desktop). */
export async function loadImageNaturalDimensions(imageUrl) {
  if (!imageUrl) return null;

  const { normalizeLocalAssetUrl, resolveDesktopAssetUrl } = await import("@/lib/apiClient");
  const src = await resolveDesktopAssetUrl(normalizeLocalAssetUrl(imageUrl));

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!img.naturalWidth || !img.naturalHeight) {
        reject(new Error("Plan image has no readable dimensions"));
        return;
      }
      resolve({
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
      });
    };
    img.onerror = () => reject(new Error("Could not load plan image to read dimensions"));
    img.src = src;
  });
}

/** True when a marker has coordinates that can be drawn on the plan image. */
export function markerHasPlacedPosition(marker = {}) {
  if (typeof marker.relativeX === "number" && typeof marker.relativeY === "number") {
    return true;
  }
  if (typeof marker.x === "number" && typeof marker.y === "number") {
    return true;
  }
  return false;
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

/** Scale overlay markers to match how large the plan image is on screen. */
export function getPlanMarkerScale(dims, { min = 0.35, max = 1.25 } = {}) {
  if (!dims?.naturalWidth || !dims?.width) return 1;
  const scale = dims.width / dims.naturalWidth;
  return Math.min(Math.max(scale, min), max);
}

/**
 * Building floor-button sizes from displayed image width:
 * - width  = imageWidth × (70 ÷ floorCount) ÷ 100
 * - height = imageWidth × 7 ÷ 100
 */
export function getFloorButtonDimensions(dims, floorCount) {
  const imageWidth = dims?.width || 0;
  const count = Math.max(Number(floorCount) || 1, 1);
  const buttonWidth =
    imageWidth > 0 ? (imageWidth * 70) / count / 100 : 72;
  const buttonHeight = imageWidth > 0 ? (imageWidth * 7) / 100 : 56;
  const iconSize = Math.max(8, buttonHeight * 0.2);
  const floorLabelSize = Math.max(6, buttonHeight * 0.11);
  const nameLabelSize = Math.max(7, buttonHeight * 0.15);
  const gap = Math.max(2, imageWidth * 0.004);
  const rowWidth = imageWidth > 0 ? imageWidth * 0.7 : buttonWidth * count;

  return {
    buttonWidth,
    buttonHeight,
    iconSize,
    floorLabelSize,
    nameLabelSize,
    gap,
    rowWidth,
  };
}

/** Section/subsection nav marker sizes from displayed image width. */
export function getNavMarkerDimensions(dims) {
  const imageWidth = dims?.width || 0;
  const buttonWidth = imageWidth > 0 ? (imageWidth * 9) / 100 : 72;
  const buttonHeight = imageWidth > 0 ? (imageWidth * 4) / 100 : 32;
  const fontSize = Math.max(10, buttonHeight * 0.36);
  const padX = Math.max(6, buttonWidth * 0.1);
  const padY = Math.max(4, buttonHeight * 0.12);

  return { buttonWidth, buttonHeight, fontSize, padX, padY };
}

/** Breadcrumb trail for nested navigation. */
export function buildBreadcrumbs(level, { buildingName, floor, section, subsection }) {
  const crumbs = [{ level: NAV_LEVELS.BUILDING, label: buildingName || "Building" }];

  if (level === NAV_LEVELS.BUILDING) return crumbs;

  if (level === NAV_LEVELS.DEVICE_GUIDE) {
    crumbs.push({ level: NAV_LEVELS.DEVICE_GUIDE, label: "Legend" });
    return crumbs;
  }

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
      ? {
          id: floor.id,
          name: floor.name,
          imageUrl: floor.imageUrl || "",
          order: floor.order ?? 0,
        }
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
