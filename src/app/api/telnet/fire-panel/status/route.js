import { proxyToDesktopServer } from "@/lib/desktopServerProxy";

export async function GET(request) {
  return proxyToDesktopServer("/api/telnet/fire-panel/status", request);
}
