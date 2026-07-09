/** Built-in category / equipment type icons under /public/asset/icons/. */
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

/** Common fire / life-safety item types mapped to bundled icons. */
export const ITEM_TYPE_ICONS = {
  "ALARM RELAY": "/asset/icons/control-unit.svg",
  "AUXILIARY RELAY": "/asset/icons/control-unit.svg",
  "CONTROL MODULE": "/asset/icons/control-unit.svg",
  "MONITOR MODULE": "/asset/icons/control-unit.svg",
  "INTERFACE UNIT": "/asset/icons/control-unit.svg",
  "FIRE ALARM CONTROL PANEL": "/asset/icons/control-unit.svg",
  "MASTER FIRE PANEL": "/asset/icons/control-unit.svg",
  "PHOTO ELECTRIC SMOKE SENSOR": "/asset/icons/control-unit.svg",
  "HEAT SENSOR": "/asset/icons/control-unit.svg",
  "MULTI SENSOR (SMOKE/HEAT)": "/asset/icons/control-unit.svg",
  "VOID SMOKE SENSOR": "/asset/icons/control-unit.svg",
  "WALL MOUNTED PHOTO ELECTRIC SMOKE SENSOR": "/asset/icons/control-unit.svg",
  "CEILING MOUNTED EVACUATION SPEAKER": "/asset/icons/fan.svg",
  "WALL MOUNTED FIRE ALARM SOUNDER": "/asset/icons/fan.svg",
  "WALL MOUNTED FIRE ALARM SOUNDER WITH FLASHER": "/asset/icons/fan.svg",
  "WALL MOUNTED STROBE LIGHT": "/asset/icons/fan.svg",
  "DOUBLE ACTION ADDRESSABLE PULLSTATION": "/asset/icons/control-unit.svg",
  "FIRE FIGHTING": "/asset/icons/chemical.svg",
  "PUMP": "/asset/icons/pump.svg",
  "JOCKEY PUMP": "/asset/icons/pump.svg",
  "DIESEL PUMP": "/asset/icons/pump.svg",
  "ELECTRICAL PUMP": "/asset/icons/pump.svg",
};

let assetTypeIconOverrides = {};

export function setAssetTypeIconOverrides(overrides = {}) {
  assetTypeIconOverrides = { ...overrides };
}

export function getAssetTypeIconOverrides() {
  return assetTypeIconOverrides;
}

/** Normalize type keys for case-insensitive icon lookup. */
export function normalizeAssetTypeKey(value = "") {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/** Best label to resolve an icon for a floor-map mapping or picker row. */
export function resolveAssetTypeFromMapping(mapping = {}) {
  const candidates = [
    mapping.itemType,
    mapping.assetType,
    mapping.type,
    mapping.system,
    mapping.assetName,
    mapping.name,
    mapping.category,
    mapping.categoryKey,
    mapping.description,
  ];

  for (const candidate of candidates) {
    const key = normalizeAssetTypeKey(candidate);
    if (!key) continue;
    // Skip values that look like device addresses, not equipment types.
    if (/^\d+:/.test(key) || /^M\d+-\d+/i.test(key)) continue;
    return key;
  }

  return normalizeAssetTypeKey(mapping.assetName || mapping.name || "");
}

function lookupBuiltinIcon(typeKey) {
  if (!typeKey) return CATEGORY_ICONS.DEFAULT;
  if (CATEGORY_ICONS[typeKey]) return CATEGORY_ICONS[typeKey];
  if (ITEM_TYPE_ICONS[typeKey]) return ITEM_TYPE_ICONS[typeKey];

  if (typeKey.includes("SMOKE") || typeKey.includes("HEAT") || typeKey.includes("SENSOR")) {
    return "/asset/icons/control-unit.svg";
  }
  if (
    typeKey.includes("SPEAKER") ||
    typeKey.includes("SOUND") ||
    typeKey.includes("STROBE") ||
    typeKey.includes("EVACUATION")
  ) {
    return "/asset/icons/fan.svg";
  }
  if (typeKey.includes("PUMP") || typeKey.includes("CHWP")) {
    return "/asset/icons/pump.svg";
  }
  if (
    typeKey.includes("RELAY") ||
    typeKey.includes("MODULE") ||
    typeKey.includes("PANEL") ||
    typeKey.includes("MONITOR") ||
    typeKey.includes("CONTROL") ||
    typeKey.includes("INTERFACE")
  ) {
    return "/asset/icons/control-unit.svg";
  }
  if (typeKey.includes("CHILLER")) return "/asset/icons/chillers.svg";
  if (typeKey.includes("FAN") || typeKey.includes("AHU")) {
    return "/asset/icons/air-handling-unit.svg";
  }
  if (typeKey.includes("CHEMICAL") || typeKey.includes("SPRINKLER")) {
    return "/asset/icons/chemical.svg";
  }

  return CATEGORY_ICONS.DEFAULT;
}

/** Icon for a single asset type string (built-in + user overrides). */
export function getIconForAssetType(typeKey, customImageUrl = null, overrides = assetTypeIconOverrides) {
  if (customImageUrl) return customImageUrl;

  const normalized = normalizeAssetTypeKey(typeKey);
  if (normalized && overrides[normalized]) {
    return overrides[normalized];
  }

  return lookupBuiltinIcon(normalized);
}

/** Prioritize per-asset custom image, then type override, then built-in icons. */
export function getIconForCategory(category, customImageUrl = null, overrides = assetTypeIconOverrides) {
  if (customImageUrl) return customImageUrl;
  return getIconForAssetType(category, null, overrides);
}

/** Resolve floor-map marker image from mapping fields. */
export function getMarkerImageSrc(mapping, overrides = assetTypeIconOverrides) {
  const custom = String(mapping?.customImageUrl || "").trim();
  if (custom) return custom;
  return getIconForAssetType(resolveAssetTypeFromMapping(mapping), null, overrides);
}

export function handleImageError(event) {
  if (!event.currentTarget.src.endsWith(CATEGORY_ICONS.DEFAULT)) {
    event.currentTarget.src = CATEGORY_ICONS.DEFAULT;
  }
}
