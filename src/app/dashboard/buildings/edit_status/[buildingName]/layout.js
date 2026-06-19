import fs from "fs";
import path from "path";

/** Pre-generate building pages for static desktop export */
export function generateStaticParams() {
  try {
    const dbPath = path.join(process.cwd(), "data", "db.json");
    const db = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
    const buildings = Object.keys(db).filter((k) => k.endsWith("BuildingDB"));
    const params = buildings.map((key) => ({
      buildingName: key.replace(/BuildingDB$/i, ""),
    }));
    return params.length > 0 ? params : [{ buildingName: "placeholder" }];
  } catch {
    return [{ buildingName: "placeholder" }];
  }
}

export default function BuildingEditLayout({ children }) {
  return children;
}
