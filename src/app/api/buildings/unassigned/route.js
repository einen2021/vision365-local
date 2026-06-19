import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import { readDb } from "@/lib/serverDb";
import { listUnassignedBuildings } from "@/lib/communityBuildings";

export async function GET(request) {
  const proxied = await tryProxyToDesktopServer(request, "/api/buildings/unassigned");
  if (proxied) return proxied;

  const db = await readDb();
  const buildings = listUnassignedBuildings(db);
  return NextResponse.json({ status: true, buildings });
}
