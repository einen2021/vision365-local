import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import { readDb } from "@/lib/serverDb";
import { getBuildingDbKeys } from "@/lib/communityBuildings";

export async function POST(request) {
  const proxied = await tryProxyToDesktopServer(request, "/api/building/all");
  if (proxied) return proxied;

  const db = await readDb();
  const buildings = getBuildingDbKeys(db);
  return NextResponse.json({
    status: true,
    buildings,
    message: `Found ${buildings.length} building(s)`,
  });
}
