import { NextResponse } from "next/server";
import net from "net";

const DESKTOP_API_HOST = "127.0.0.1";
const DESKTOP_API_PORT = Number(process.env.VISION365_PORT || 47821);

/**
 * Forward a Next.js API request to the local Hono desktop server.
 * Used when the app runs in the browser (next dev) instead of inside Tauri.
 */
export async function proxyToDesktopServer(apiPath, request, timeoutMs = 5000) {
  const proxied = await tryProxyToDesktopServer(request, apiPath, null, timeoutMs);
  if (proxied) return proxied;

  return NextResponse.json(
    {
      error: "Local API server is not running. Start it with: npm run desktop:dev",
    },
    { status: 503 }
  );
}

/**
 * Try forwarding to desktop-server. Returns null when the server is unavailable
 * so routes can fall back to the embedded Next.js MongoDB (npm run dev only).
 */
export async function tryProxyToDesktopServer(
  request,
  apiPath,
  bodyText = null,
  timeoutMs = 5000,
) {
  const url = `http://${DESKTOP_API_HOST}:${DESKTOP_API_PORT}${apiPath}`;

  try {
    const init = {
      method: request.method,
      headers: {},
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (request.method !== "GET" && request.method !== "HEAD") {
      const body = bodyText ?? (await request.text());
      if (body) {
        init.body = body;
        init.headers["Content-Type"] =
          request.headers.get("content-type") || "application/json";
      }
    }

    const res = await fetch(url, init);
    const text = await res.text();

    return new NextResponse(text, {
      status: res.status,
      headers: {
        "Content-Type": res.headers.get("content-type") || "application/json",
      },
    });
  } catch {
    return null;
  }
}

/** Quick check if desktop API server is listening */
export async function isDesktopServerRunning() {
  return new Promise((resolve) => {
    const socket = net.createConnection(
      { host: DESKTOP_API_HOST, port: DESKTOP_API_PORT },
      () => {
        socket.end();
        resolve(true);
      }
    );
    socket.on("error", () => resolve(false));
    setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 500);
  });
}
