/** Category icons — same mapping as vision365-frontend-main floor_configuration pages. */
export const CATEGORY_ICONS = {
  "AIR CURTIN": "/asset/icons/air-curtain.svg",
  ACAHU: "/asset/icons/air-handle.svg",
  CCUI: "/asset/icons/control-unit.svg",
  ACCDU: "/asset/icons/chemical.svg",
  ACCH: "/asset/icons/chillers.svg",
  ACCHWP: "/asset/icons/pump.svg",
  ACFAHU: "/asset/icons/air-handling-unit.svg",
  "FAN COIL": "/asset/icons/fan.svg",
  DEFAULT: "/asset/icons/default.svg",
};

/** Prioritize custom upload, then category icon, then default. */
export function getIconForCategory(category, customImageUrl = null) {
  if (customImageUrl) {
    return customImageUrl;
  }
  return CATEGORY_ICONS[category] || CATEGORY_ICONS.DEFAULT;
}

/** Resolve floor-map marker image (same pattern as vision365-frontend-main dashboard). */
export function getMarkerImageSrc(mapping) {
  if (mapping?.customImageUrl) {
    return mapping.customImageUrl;
  }
  return getIconForCategory(mapping?.category, null);
}

export function handleImageError(event) {
  if (!event.currentTarget.src.endsWith(CATEGORY_ICONS.DEFAULT)) {
    event.currentTarget.src = CATEGORY_ICONS.DEFAULT;
  }
}
