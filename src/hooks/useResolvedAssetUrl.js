"use client";

import { useEffect, useRef, useState } from "react";
import { isDesktop } from "@/lib/platform";
import {
  normalizeLocalAssetUrl,
  primeAssetUrlResolver,
  resolveAssetUrl,
  resolveDesktopAssetUrl,
} from "@/lib/apiClient";
import { cacheResolvedUrl, getCachedResolvedUrl } from "@/lib/assetUrlCache";

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
  if (source.startsWith("/local/")) return false;
  return true;
}

function resolveSynchronously(source) {
  const resolved = resolveAssetUrl(source);
  cacheResolvedUrl(source, resolved);
  return resolved;
}

/** Floor-plan / upload image URL that works in browser dev and Tauri desktop. */
export function useResolvedAssetUrl(url) {
  const blobUrlRef = useRef(null);

  const [resolved, setResolved] = useState(() => {
    const source = normalizeLocalAssetUrl(url || "");
    if (!source) return "";

    const cached = getCachedResolvedUrl(source);
    if (cached) return cached;

    if (!canResolveSynchronously(source)) return "";
    return resolveSynchronously(source);
  });

  useEffect(() => {
    let active = true;

    const releaseOwnedBlob = () => {
      if (!blobUrlRef.current) return;
      const cached = getCachedResolvedUrl(normalizeLocalAssetUrl(url || ""));
      if (cached !== blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
      blobUrlRef.current = null;
    };

    async function resolve() {
      const source = normalizeLocalAssetUrl(url || "");

      if (!source) {
        releaseOwnedBlob();
        if (active) setResolved("");
        return;
      }

      const cached = getCachedResolvedUrl(source);
      if (cached) {
        releaseOwnedBlob();
        if (active) setResolved(cached);
        return;
      }

      if (isDesktop() && source.startsWith("/local/")) {
        const assetUrl = await resolveDesktopAssetUrl(source);
        if (!active) return;
        cacheResolvedUrl(source, assetUrl);
        releaseOwnedBlob();
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
        cacheResolvedUrl(source, assetUrl);
        releaseOwnedBlob();
        if (assetUrl.startsWith("blob:")) {
          blobUrlRef.current = assetUrl;
        }
        setResolved(assetUrl);
        return;
      }

      releaseOwnedBlob();
      const assetUrl = resolveSynchronously(source);
      if (active) setResolved(assetUrl);
    }

    void resolve();

    return () => {
      active = false;
      releaseOwnedBlob();
    };
  }, [url]);

  return resolved;
}
