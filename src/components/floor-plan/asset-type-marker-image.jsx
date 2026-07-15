"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getIconForAssetType,
  getMarkerImageSrc,
  handleImageError,
  resolveAssetTypeFromMapping,
} from "@/lib/assetIcons";
import { useResolvedAssetUrl } from "@/hooks/useResolvedAssetUrl";
import {
  isAssetImageLoaded,
  markAssetImageLoaded,
  preloadAssetImage,
} from "@/lib/assetUrlCache";

function isUnresolvedLocalPath(src) {
  return String(src || "").startsWith("/local/");
}

function buildTypeOverrides(typeKey, typeIconUrl) {
  if (!typeKey || !typeIconUrl) return {};
  return { [typeKey]: typeIconUrl };
}

/**
 * Floor-plan marker icon with type overrides, URL resolution (desktop /local/), and fallbacks.
 * Uses a single image element and preloads custom icons to avoid blinking across many markers.
 */
export function AssetTypeMarkerImage({
  mapping,
  typeIconUrl = "",
  className,
  style,
  alt = "asset",
}) {
  const [useTypeOverrideOnly, setUseTypeOverrideOnly] = useState(false);
  const [displaySrc, setDisplaySrc] = useState("");

  const typeKey = resolveAssetTypeFromMapping(mapping);
  const placeholderSrc = getIconForAssetType(typeKey, null, {});
  const typeOverrides = useMemo(
    () => buildTypeOverrides(typeKey, typeIconUrl),
    [typeKey, typeIconUrl],
  );

  const primarySrc = useTypeOverrideOnly
    ? getIconForAssetType(typeKey, typeIconUrl || null, {})
    : getMarkerImageSrc(mapping, typeOverrides);

  const needsAsyncResolve = isUnresolvedLocalPath(primarySrc);
  const resolvedSrc = useResolvedAssetUrl(needsAsyncResolve ? primarySrc : "");

  const customSrc = useMemo(() => {
    if (!primarySrc) return "";
    if (needsAsyncResolve) {
      return resolvedSrc || "";
    }
    return primarySrc;
  }, [needsAsyncResolve, primarySrc, resolvedSrc]);

  const hasCustomIcon = Boolean(customSrc && customSrc !== placeholderSrc);

  const applyDisplaySrc = useCallback(
    (nextSrc) => {
      setDisplaySrc((current) => (current === nextSrc ? current : nextSrc));
    },
    [],
  );

  useEffect(() => {
    if (!hasCustomIcon || !customSrc) {
      applyDisplaySrc(placeholderSrc);
      return;
    }

    if (isAssetImageLoaded(customSrc)) {
      applyDisplaySrc(customSrc);
      return;
    }

    let cancelled = false;
    applyDisplaySrc(placeholderSrc);

    void preloadAssetImage(customSrc).then((loaded) => {
      if (cancelled) return;
      applyDisplaySrc(loaded ? customSrc : placeholderSrc);
    });

    return () => {
      cancelled = true;
    };
  }, [applyDisplaySrc, customSrc, hasCustomIcon, placeholderSrc]);

  const handleError = (event) => {
    if (!useTypeOverrideOnly && mapping?.customImageUrl) {
      setUseTypeOverrideOnly(true);
      return;
    }

    const typeFallback = getIconForAssetType(typeKey, typeIconUrl || null, typeOverrides);
    if (typeFallback && event.currentTarget.src !== typeFallback) {
      event.currentTarget.src = typeFallback;
      return;
    }

    handleImageError(event);
    applyDisplaySrc(placeholderSrc);
  };

  const handleLoad = () => {
    if (displaySrc && displaySrc !== placeholderSrc) {
      markAssetImageLoaded(displaySrc);
    }
  };

  return (
    <img
      src={displaySrc || placeholderSrc}
      alt={alt}
      className={className}
      style={style}
      onLoad={handleLoad}
      onError={handleError}
    />
  );
}
