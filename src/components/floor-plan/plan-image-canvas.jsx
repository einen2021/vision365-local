"use client";

import { useRef, useState, useEffect } from "react";
import { MapPin, Loader2, ImageOff, Layers } from "lucide-react";
import { useFloorPlanImageDimensions } from "@/hooks/useFloorPlanImageDimensions";
import { useResolvedAssetUrl } from "@/hooks/useResolvedAssetUrl";
import { naturalToScreenCoords } from "@/lib/nestedFloorPlan";
import { FloorMapAssetMarker } from "@/components/floor-map-asset-marker";

/**
 * Shared floor-plan image with navigation hotspots or asset markers.
 * Resolves /local/ and storage URLs automatically (web + desktop).
 */
export function PlanImageCanvas({
  imageUrl,
  alt = "Floor plan",
  markers = [],
  navMarkers,
  assetMarkers,
  mode = "nav",
  onImageClick,
  onMarkerClick,
  onAssetClick,
  placingMarker = false,
  browserZoom = 1,
  assetStatusLive = false,
  activeStatuses = {},
  assetDeviceData = {},
  className = "",
  maxHeight = "min(70vh, 600px)",
  navMarkerStyle = "pin",
}) {
  const imageRef = useRef(null);
  const resolvedSrc = useResolvedAssetUrl(imageUrl);
  const [imgError, setImgError] = useState(false);

  const resolvedNavMarkers =
    navMarkers ?? (mode === "nav" || mode === "mixed" ? markers : []);
  const resolvedAssetMarkers =
    assetMarkers ?? (mode === "assets" ? markers : []);

  const { dims, imageLoaded, handleImageLoad } = useFloorPlanImageDimensions(
    imageRef,
    resolvedSrc,
  );

  useEffect(() => {
    setImgError(false);
  }, [imageUrl, resolvedSrc]);

  const handleClick = (event) => {
    if (!onImageClick || !imageLoaded) return;
    onImageClick(event, imageRef, dims);
  };

  const renderNavMarker = (marker) => {
    const { left, top } = naturalToScreenCoords(marker, dims);

    if (navMarkerStyle === "floorButton") {
      return (
        <button
          key={marker.id}
          type="button"
          className="absolute z-20 -translate-x-1/2 -translate-y-1/2"
          style={{ left, top }}
          onClick={(e) => {
            e.stopPropagation();
            onMarkerClick?.(marker);
          }}
          title={marker.name}
        >
          <span className="flex min-w-[7rem] flex-col items-center rounded-md border-2 border-primary bg-background/95 px-3 py-2 shadow-lg transition-colors hover:bg-primary/10">
            <Layers className="mb-1 h-5 w-5 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
              Select Floor
            </span>
            <span className="text-sm font-medium">{marker.name}</span>
          </span>
        </button>
      );
    }

    return (
      <button
        key={marker.id}
        type="button"
        className="absolute z-20 flex flex-col items-center -translate-x-1/2 -translate-y-1/2 group"
        style={{ left, top }}
        onClick={(e) => {
          e.stopPropagation();
          onMarkerClick?.(marker);
        }}
        title={marker.name}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-primary bg-primary/90 text-primary-foreground shadow-md transition-transform group-hover:scale-110">
          <MapPin className="h-4 w-4" />
        </span>
        <span className="mt-1 max-w-[8rem] truncate rounded bg-background/90 px-2 py-0.5 text-xs font-medium shadow">
          {marker.name}
        </span>
      </button>
    );
  };

  const hasStoredUrl = Boolean(imageUrl);
  const isResolving = hasStoredUrl && !resolvedSrc && !imgError;
  const canRenderImage = Boolean(resolvedSrc) && !imgError;

  return (
    <div className={`relative w-full ${className}`}>
      <div
        className="relative w-full flex items-center justify-center bg-muted/30 rounded-lg overflow-hidden"
        style={{ minHeight: 280, maxHeight }}
      >
        {isResolving ? (
          <div className="flex flex-col items-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading plan image...</p>
          </div>
        ) : null}

        {!hasStoredUrl && !isResolving ? (
          <p className="text-sm text-muted-foreground p-8">No plan image uploaded</p>
        ) : null}

        {hasStoredUrl && imgError ? (
          <div className="flex flex-col items-center gap-2 p-8 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <p className="text-sm">Could not load plan image</p>
            <p className="text-xs max-w-xs truncate opacity-70">{imageUrl}</p>
          </div>
        ) : null}

        {canRenderImage ? (
          <div
            className="relative inline-block max-w-full max-h-full"
            style={{ maxHeight }}
          >
            <img
              key={resolvedSrc}
              ref={imageRef}
              src={resolvedSrc}
              alt={alt}
              className="block max-w-full max-h-full object-contain"
              onLoad={handleImageLoad}
              onError={() => setImgError(true)}
              onClick={handleClick}
              style={{ cursor: placingMarker ? "crosshair" : "default", maxHeight }}
            />

            {imageLoaded ? (
              <>
                {resolvedNavMarkers.map(renderNavMarker)}
                {resolvedAssetMarkers.map((marker) => {
                  const { left, top } = naturalToScreenCoords(marker, dims);
                  const deviceData = assetDeviceData[marker.id] || {};
                  return (
                    <FloorMapAssetMarker
                      key={marker.id}
                      mapping={marker}
                      left={left}
                      top={top}
                      browserZoom={browserZoom}
                      fallbackActive={activeStatuses[marker.id] ?? marker.active ?? 0}
                      deviceAddr={deviceData.deviceAddress || marker.deviceAddress}
                      deviceLocation={deviceData.deviceLocation || marker.deviceLocation}
                      customImageUrl={marker.customImageUrl}
                      onAssetClick={onAssetClick}
                      live={assetStatusLive}
                    />
                  );
                })}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
