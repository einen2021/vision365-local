import { proxyToDesktopServer } from "@/lib/desktopServerProxy";

export async function POST(request) {
  // Poll reads multiple panel lists and can exceed the default 5s proxy timeout.
  return proxyToDesktopServer("/api/telnet/fire-panel/poll", request, 30000);
}
