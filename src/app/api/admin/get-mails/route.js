import { NextResponse } from "next/server";
import { tryProxyToDesktopServer } from "@/lib/desktopServerProxy";
import { readDb } from "@/lib/serverDb";

/** List users from UserDB for assign buildings page */
export async function GET(request) {
  const proxied = await tryProxyToDesktopServer(request, "/api/admin/get-mails");
  if (proxied) return proxied;

  const db = await readDb();
  const userDb = db.UserDB || {};
  const users = Object.entries(userDb).map(([id, data]) => ({
    id,
    email: data.email,
    role: data.role,
  }));

  return NextResponse.json({
    status: true,
    users,
    message: `Found ${users.length} user(s)`,
  });
}
