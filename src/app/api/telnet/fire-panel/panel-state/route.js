import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import { readDb } from "@/lib/serverDb";
import { getStoredPanelStateFromDb, savePanelStateCounts } from "@/lib/panelState";

export async function GET(request) {
  const proxied = await tryProxyToDesktopServer(
    request,
    "/api/telnet/fire-panel/panel-state",
  );
  if (proxied) return proxied;

  try {
    const db = await readDb();
    return NextResponse.json(getStoredPanelStateFromDb(db));
  } catch (error) {
    console.error("[api/telnet/fire-panel/panel-state]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  const bodyText = await request.text();
  const proxied = await tryProxyToDesktopServer(
    request,
    "/api/telnet/fire-panel/panel-state",
    bodyText,
  );
  if (proxied) return proxied;

  try {
    const body = JSON.parse(bodyText);
    const state = await savePanelStateCounts(body);
    return NextResponse.json(state);
  } catch (error) {
    console.error("[api/telnet/fire-panel/panel-state]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
