/**
 * Building name helpers used across the app.
 *
 * Firestore stores buildings as collections like "TowerABuildingDB".
 * In the UI we usually show the short name "TowerA".
 */

/** Strip "BuildingDB" suffix and handle string or object inputs. */
export function normalizeBuildingName(building) {
  if (typeof building === "string") {
    const s = building.trim();
    if (!s) return "";
    return s.endsWith("BuildingDB") ? s.slice(0, -"BuildingDB".length) : s;
  }

  if (building && typeof building === "object") {
    const raw = building.buildingName ?? building.name ?? building.id;
    if (raw == null) return "";
    const s = String(raw).trim();
    return s.endsWith("BuildingDB") ? s.slice(0, -"BuildingDB".length) : s;
  }

  return "";
}

/** Turn "TowerA" into "TowerABuildingDB" for Firestore collection names. */
export function toBuildingCollectionName(name) {
  const base = normalizeBuildingName(name);
  if (!base) return "";
  return base.endsWith("BuildingDB") ? base : `${base}BuildingDB`;
}
