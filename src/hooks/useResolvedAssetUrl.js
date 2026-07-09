"use client";

import { useEffect, useRef, useState } from "react";
import { isDesktop } from "@/lib/platform";
import {
  normalizeLocalAssetUrl,
  primeAssetUrlResolver,
  resolveAssetUrl,
  resolveDesktopAssetUrl,
} from "@/lib/apiClient";

function canResolveSynchronously(source) {
  if (!source) return true;
  if (
    source.startsWith("blob:") ||
    source.startsWith("data:") ||
    source.startsWith("http://") ||
    source.startsWith("https://")
  ) {
    return true;
  }
  // /local/ paths need the desktop API or Tauri convertFileSrc
  if (source.startsWith("/local/")) return false;
  return true;
}

/** Floor-plan / upload image URL that works in browser dev and Tauri desktop. */
export function useResolvedAssetUrl(url) {
  const blobUrlRef = useRef(null);

  const [resolved, setResolved] = useState(() => {
    const source = normalizeLocalAssetUrl(url || "");
    if (!source) return "";
    if (!canResolveSynchronously(source)) return "";
    return resolveAssetUrl(source);
  });

  useEffect(() => {
    let active = true;

    const revokeBlob = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };

    async function resolve() {
      const source = normalizeLocalAssetUrl(url || "");

      if (!source) {
        revokeBlob();
        if (active) setResolved("");
        return;
      }

      if (isDesktop() && source.startsWith("/local/")) {
        const assetUrl = await resolveDesktopAssetUrl(source);
        if (!active) return;
        revokeBlob();
        if (assetUrl.startsWith("blob:")) {
          blobUrlRef.current = assetUrl;
        }
        setResolved(assetUrl);
        return;
      }

      await primeAssetUrlResolver();
      if (!active) return;

      if (source.startsWith("/local/")) {
        const assetUrl = await resolveDesktopAssetUrl(source);
        if (!active) return;
        revokeBlob();
        if (assetUrl.startsWith("blob:")) {
          blobUrlRef.current = assetUrl;
        }
        setResolved(assetUrl);
        return;
      }

      revokeBlob();
      setResolved(resolveAssetUrl(source));
    }

    resolve();

    return () => {
      active = false;
      revokeBlob();
    };
  }, [url]);

  return resolved;
}
