import { normalizeAssetTypeKey } from "@/lib/assetIcons";

/** Same type list as the Asset Type Icons settings modal. */
export function buildAssetTypeList({
  knownTypes = [],
  extraTypes = [],
  overrides = {},
} = {}) {
  const merged = new Set([
    ...knownTypes.map(normalizeAssetTypeKey),
    ...extraTypes.map(normalizeAssetTypeKey).filter(Boolean),
  ]);
  Object.keys(overrides || {}).forEach((key) => merged.add(key));
  return Array.from(merged)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/** Device guide rows — one per asset type from AssetsList (plus extras/overrides). */
export function buildDeviceGuideItems({
  knownTypes = [],
  extraTypes = [],
  overrides = {},
} = {}) {
  return buildAssetTypeList({ knownTypes, extraTypes, overrides }).map((typeKey) => ({
    id: typeKey,
    typeKey,
    label: typeKey,
    mapping: { itemType: typeKey, assetName: typeKey },
    typeIconUrl: overrides[typeKey] || "",
    hasCustomIcon: Boolean(overrides[typeKey]),
  }));
}
