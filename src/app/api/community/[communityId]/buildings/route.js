import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import { readDb } from "@/lib/serverDb";
import { getCommunityBuildingsList } from "@/lib/communityBuildings";

export async function GET(request, { params }) {
  const { communityId } = await params;
  const proxied = await tryProxyToDesktopServer(
    request,
    `/api/community/${communityId}/buildings`
  );
  if (proxied) return proxied;

  const db = await readDb();
  const buildings = getCommunityBuildingsList(db, communityId);
  return NextResponse.json({ status: true, buildings });
}
