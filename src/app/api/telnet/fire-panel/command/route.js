import { proxyToDesktopServer } from "@/lib/desktopServerProxy";

function proxyTimeoutMs(request) {
  const header = request.headers.get("x-proxy-timeout-ms");
  if (header) {
    const parsed = Number(header);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 70000;
}

export async function POST(request) {
  const bodyText = await request.text();
  let timeoutMs = 70000;

  try {
    const body = JSON.parse(bodyText);
    const panelTimeout = Number(body.timeoutMs);
    if (Number.isFinite(panelTimeout) && panelTimeout > 0) {
      // Panel wait + network buffer for long commands like "cshow *"
      timeoutMs = Math.max(panelTimeout + 10000, 30000);
    }
  } catch {
    timeoutMs = proxyTimeoutMs(request);
  }

  return proxyToDesktopServer(
    "/api/telnet/fire-panel/command",
    new Request(request.url, {
      method: request.method,
      headers: request.headers,
      body: bodyText,
    }),
    timeoutMs,
  );
}
