"use client";

import { useEffect, useState } from "react";
import {
  getIconForAssetType,
  getMarkerImageSrc,
  handleImageError,
  resolveAssetTypeFromMapping,
} from "@/lib/assetIcons";
import { useResolvedAssetUrl } from "@/hooks/useResolvedAssetUrl";
import { useAssetTypeIcons } from "@/contexts/AssetTypeIconsContext";

function isUnresolvedLocalPath(src) {
  return String(src || "").startsWith("/local/");
}

/**
 * Floor-plan marker icon with type overrides, URL resolution (desktop /local/), and fallbacks.
 * Shows a stable built-in placeholder immediately, then crossfades to the custom icon once loaded.
 */
export function AssetTypeMarkerImage({ mapping, className, style, alt = "asset" }) {
  const { overrides } = useAssetTypeIcons();
  const [useTypeOverrideOnly, setUseTypeOverrideOnly] = useState(false);
  const [customLoaded, setCustomLoaded] = useState(false);

  const typeKey = resolveAssetTypeFromMapping(mapping);
  const placeholderSrc = getIconForAssetType(typeKey, null, {});
  const primarySrc = useTypeOverrideOnly
    ? getIconForAssetType(typeKey, null, overrides)
    : getMarkerImageSrc(mapping, overrides);
  const resolvedSrc = useResolvedAssetUrl(primarySrc);

  const customSrc =
    resolvedSrc || (primarySrc && !isUnresolvedLocalPath(primarySrc) ? primarySrc : "");
  const hasCustomIcon = Boolean(customSrc && customSrc !== placeholderSrc);

  useEffect(() => {
    setCustomLoaded(false);
    if (!hasCustomIcon) return;

    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setCustomLoaded(true);
    };
    img.onerror = () => {
      if (!cancelled) setCustomLoaded(false);
    };
    img.src = customSrc;

    return () => {
      cancelled = true;
    };
  }, [customSrc, hasCustomIcon]);

  const handleCustomError = (event) => {
    if (!useTypeOverrideOnly && mapping?.customImageUrl) {
      setUseTypeOverrideOnly(true);
      return;
    }

    const typeFallback = getIconForAssetType(typeKey, null, overrides);
    if (typeFallback && event.currentTarget.src !== typeFallback) {
      event.currentTarget.src = typeFallback;
      return;
    }

    handleImageError(event);
    setCustomLoaded(false);
  };

  const showCustom = hasCustomIcon && customLoaded;

  return (
    <span className="relative block h-full w-full overflow-hidden">
      <img
        src={placeholderSrc}
        alt={showCustom ? "" : alt}
        aria-hidden={showCustom}
        className={className}
        style={{
          ...style,
          opacity: showCustom ? 0 : 1,
          transition: "opacity 150ms ease",
        }}
      />
      {hasCustomIcon ? (
        <img
          src={customSrc}
          alt={alt}
          className={`absolute inset-0 h-full w-full ${className || ""}`}
          style={{
            ...style,
            opacity: showCustom ? 1 : 0,
            transition: "opacity 150ms ease",
          }}
          onError={handleCustomError}
        />
      ) : null}
    </span>
  );
}
