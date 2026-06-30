"use client";

import { useEffect, useState } from "react";
import { resolvePublicAssetUrl } from "@/lib/platform";

const LOGO_PATH = "/logo.png";

/**
 * Vision365 brand mark — works in web dev, static export, and Tauri desktop.
 * Uses /logo.png from public/ (copied to out/ in desktop builds).
 */
export function Vision365Logo({
  className = "h-8 w-8",
  alt = "Vision365",
  rounded = true,
}) {
  const [src, setSrc] = useState(() => resolvePublicAssetUrl(LOGO_PATH));

  useEffect(() => {
    setSrc(resolvePublicAssetUrl(LOGO_PATH));
  }, []);

  return (
    <img
      src={src}
      alt={alt}
      className={`object-contain ${rounded ? "rounded-md" : ""} ${className}`}
      draggable={false}
      onError={() => {
        // Last-resort fallback for nested static routes in the desktop webview.
        if (!src.endsWith("logo.png")) {
          setSrc("logo.png");
        }
      }}
    />
  );
}
