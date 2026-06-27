import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import { readDb } from "@/lib/serverDb";
import { sumAlarmDetailsFromDb } from "@/lib/alarmDetailsTotals";

export async function GET(request) {
  const proxied = await tryProxyToDesktopServer(
    request,
    "/api/telnet/fire-panel/alarm-totals",
  );
  if (proxied) return proxied;

  try {
    const db = await readDb();
    return NextResponse.json(sumAlarmDetailsFromDb(db));
  } catch (error) {
    console.error("[api/telnet/fire-panel/alarm-totals]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
