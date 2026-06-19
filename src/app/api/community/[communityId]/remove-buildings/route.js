import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import { readDb, writeDb } from "@/lib/serverDb";
import { removeBuildingsFromCommunity } from "@/lib/communityBuildings";

export async function POST(request, { params }) {
  const { communityId } = await params;
  const bodyText = await request.text();
  const proxied = await tryProxyToDesktopServer(
    request,
    `/api/community/${communityId}/remove-buildings`,
    bodyText
  );
  if (proxied) return proxied;

  const body = JSON.parse(bodyText);
  const db = await readDb();
  const result = removeBuildingsFromCommunity(
    db,
    communityId,
    body.buildings || [],
    body.updatedBy
  );
  if (result.status) await writeDb(db);
  return NextResponse.json(result);
}
