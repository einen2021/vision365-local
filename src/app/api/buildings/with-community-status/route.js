import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import { readDb } from "@/lib/serverDb";
import { listAllBuildingsWithStatus } from "@/lib/communityBuildings";

export async function POST(request) {
  const proxied = await tryProxyToDesktopServer(request, "/api/buildings/with-community-status");
  if (proxied) return proxied;

  const db = await readDb();
  const buildings = listAllBuildingsWithStatus(db);
  return NextResponse.json({ status: true, buildings });
}
