"use client";

import { useEffect, useRef, useState } from "react";
import { isDesktop } from "@/lib/platform";
import {
  normalizeLocalAssetUrl,
  primeAssetUrlResolver,
  resolveAssetUrl,
  resolveDesktopAssetUrl,
} from "@/lib/apiClient";

/** Floor-plan / upload image URL that works in browser dev and Tauri desktop. */
export function useResolvedAssetUrl(url) {
  const [resolved, setResolved] = useState(() =>
    resolveAssetUrl(normalizeLocalAssetUrl(url || "")),
  );
  const blobUrlRef = useRef(null);

  useEffect(() => {
    let active = true;

    const revokeBlob = () => {
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };

    async function resolve() {
      revokeBlob();
      const source = normalizeLocalAssetUrl(url || "");

      if (!source) {
        if (active) setResolved("");
        return;
      }

      if (isDesktop() && source.startsWith("/local/")) {
        const assetUrl = await resolveDesktopAssetUrl(source);
        if (!active) return;
        if (assetUrl.startsWith("blob:")) {
          blobUrlRef.current = assetUrl;
        }
        setResolved(assetUrl);
        return;
      }

      setResolved(resolveAssetUrl(source));
      await primeAssetUrlResolver();
      if (active) setResolved(resolveAssetUrl(source));
    }

    resolve();

    return () => {
      active = false;
      revokeBlob();
    };
  }, [url]);

  return resolved;
}
