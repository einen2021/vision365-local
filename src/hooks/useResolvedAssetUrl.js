"use client";

import { useEffect, useState } from "react";
import { primeAssetUrlResolver, resolveAssetUrl } from "@/lib/apiClient";

/** Floor-plan / upload image URL that works in browser dev and Tauri desktop. */
export function useResolvedAssetUrl(url) {
  const [resolved, setResolved] = useState(() => resolveAssetUrl(url || ""));

  useEffect(() => {
    let active = true;
    setResolved(resolveAssetUrl(url || ""));
    primeAssetUrlResolver().then(() => {
      if (active) setResolved(resolveAssetUrl(url || ""));
    });
    return () => {
      active = false;
    };
  }, [url]);

  return resolved;
}
