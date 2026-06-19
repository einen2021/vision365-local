import { NextResponse } from "next/server";

/** Proxy for 3D model URLs — passes through local paths */
export async function GET(request) {
  const url = new URL(request.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url" }, { status: 400 });
  }

  if (url.startsWith("/")) {
    return NextResponse.redirect(new URL(url, request.url));
  }

  try {
    const res = await fetch(url);
    const blob = await res.arrayBuffer();
    return new NextResponse(blob, {
      headers: { "Content-Type": res.headers.get("content-type") || "application/octet-stream" },
    });
  } catch {
    return NextResponse.json({ error: "Failed to fetch model" }, { status: 502 });
  }
}
