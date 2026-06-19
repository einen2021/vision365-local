import { proxyToDesktopServer } from "@/lib/desktopServerProxy";

export async function POST(request) {
  return proxyToDesktopServer("/api/telnet/fire-panel/connect", request);
}
