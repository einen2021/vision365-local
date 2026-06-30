"use client";

import { useRef, useState, useEffect } from "react";
import { Loader2, ImageOff, Layers } from "lucide-react";
import { useFloorPlanImageDimensions } from "@/hooks/useFloorPlanImageDimensions";
import { useResolvedAssetUrl } from "@/hooks/useResolvedAssetUrl";
import { naturalToScreenCoords, getFloorButtonDimensions, getNavMarkerDimensions } from "@/lib/nestedFloorPlan";
import { FloorMapAssetMarker } from "@/components/floor-map-asset-marker";
import { TooltipProvider } from "@/components/ui/tooltip";

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

  const navMarkerDims = getNavMarkerDimensions(dims);
  const floorButtonDims = getFloorButtonDimensions(
    dims,
    resolvedNavMarkers.length,
  );

  useEffect(() => {
    setImgError(false);
  }, [imageUrl, resolvedSrc]);

  const handleClick = (event) => {
    if (!onImageClick || !imageLoaded) return;
    onImageClick(event, imageRef, dims);
  };

  const renderFloorButton = (marker) => (
    <button
      key={marker.id}
      type="button"
      className="min-w-0 shrink-0"
      onClick={(e) => {
        e.stopPropagation();
        onMarkerClick?.(marker);
      }}
      title={marker.name}
    >
      <span
        className="flex min-w-0 flex-col items-center justify-center overflow-hidden rounded border border-primary bg-background/95 shadow-sm transition-colors hover:bg-primary/10"
        style={{
          width: floorButtonDims.buttonWidth,
          height: floorButtonDims.buttonHeight,
          padding: `${floorButtonDims.buttonHeight * 0.06}px ${floorButtonDims.buttonWidth * 0.04}px`,
        }}
      >
        <Layers
          className="mb-0.5 shrink-0 text-primary"
          style={{
            width: floorButtonDims.iconSize,
            height: floorButtonDims.iconSize,
          }}
        />
        <span
          className="font-semibold uppercase leading-none tracking-wide text-primary"
          style={{ fontSize: floorButtonDims.floorLabelSize }}
        >
          Floor
        </span>
        <span
          className="max-w-full truncate font-medium leading-tight"
          style={{ fontSize: floorButtonDims.nameLabelSize }}
        >
          {marker.name}
        </span>
      </span>
    </button>
  );

  const renderNavMarker = (marker) => {
    const { left, top } = naturalToScreenCoords(marker, dims);

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
        <span
          className="inline-flex w-auto max-w-none items-center justify-center whitespace-nowrap rounded border border-primary bg-background/95 font-medium leading-tight text-foreground shadow-sm transition-colors hover:bg-primary hover:text-primary-foreground"
          style={{
            height: navMarkerDims.buttonHeight,
            padding: `${navMarkerDims.padY}px ${navMarkerDims.padX}px`,
            fontSize: navMarkerDims.fontSize,
          }}
        >
          {marker.name}
        </span>
      </button>
    );
  };

  const renderFloorButtonGrid = () => (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-2">
      <div
        className="pointer-events-auto mx-auto flex flex-wrap justify-center"
        style={{
          width: floorButtonDims.rowWidth,
          maxWidth: "98%",
          gap: floorButtonDims.gap,
        }}
      >
        {resolvedNavMarkers.map(renderFloorButton)}
      </div>
    </div>
  );

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
              <TooltipProvider delayDuration={200}>
                {navMarkerStyle === "floorButton"
                  ? renderFloorButtonGrid()
                  : resolvedNavMarkers.map(renderNavMarker)}
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
              </TooltipProvider>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
