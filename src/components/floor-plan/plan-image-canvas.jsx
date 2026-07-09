"use client";

import { useRef, useState, useEffect } from "react";
import { Loader2, ImageOff, Layers, Trash2 } from "lucide-react";
import { useFloorPlanImageDimensions } from "@/hooks/useFloorPlanImageDimensions";
import { useResolvedAssetUrl } from "@/hooks/useResolvedAssetUrl";
import { naturalToScreenCoords, getFloorButtonDimensions, getNavMarkerDimensions } from "@/lib/nestedFloorPlan";
import { FloorMapAssetMarker } from "@/components/floor-map-asset-marker";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useAssetTypeIcons } from "@/contexts/AssetTypeIconsContext";
import { resolveAssetTypeFromMapping } from "@/lib/assetIcons";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

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
  onAssetReposition,
  onAssetRemove,
  editableAssetMarkers = false,
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
  const [assetContextMenu, setAssetContextMenu] = useState(null);

  const markersEditable = editableAssetMarkers && !placingMarker;

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
  const { overrides } = useAssetTypeIcons();

  useEffect(() => {
    setImgError(false);
    setAssetContextMenu(null);
  }, [imageUrl, resolvedSrc]);

  useEffect(() => {
    if (!assetContextMenu) return;
    const close = () => setAssetContextMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [assetContextMenu]);

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
        className="relative w-full bg-muted/30 rounded-lg overflow-hidden"
        style={{ height: maxHeight, minHeight: 280 }}
      >
        {isResolving ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">Loading plan image...</p>
          </div>
        ) : null}

        {!hasStoredUrl && !isResolving ? (
          <div className="flex h-full items-center justify-center p-8">
            <p className="text-sm text-muted-foreground">No plan image uploaded</p>
          </div>
        ) : null}

        {hasStoredUrl && imgError ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-muted-foreground">
            <ImageOff className="h-8 w-8" />
            <p className="text-sm">Could not load plan image</p>
            <p className="text-xs max-w-xs truncate opacity-70">{imageUrl}</p>
          </div>
        ) : null}

        {canRenderImage ? (
          <div className="relative h-full w-full">
            <img
              key={resolvedSrc}
              ref={imageRef}
              src={resolvedSrc}
              alt={alt}
              className="block h-full w-full object-contain"
              onLoad={handleImageLoad}
              onError={() => setImgError(true)}
              onClick={handleClick}
              style={{ cursor: placingMarker ? "crosshair" : "default" }}
            />

            {imageLoaded ? (
              <TooltipProvider delayDuration={200}>
                {navMarkerStyle === "floorButton"
                  ? renderFloorButtonGrid()
                  : resolvedNavMarkers.map(renderNavMarker)}
                {resolvedAssetMarkers.map((marker) => {
                  const { left, top } = naturalToScreenCoords(marker, dims);
                  const deviceData = assetDeviceData[marker.id] || {};
                  const typeKey = resolveAssetTypeFromMapping(marker);
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
                      typeIconUrl={typeKey ? overrides[typeKey] || "" : ""}
                      onAssetClick={onAssetClick}
                      editable={markersEditable}
                      imageRef={imageRef}
                      imageDims={dims}
                      onReposition={onAssetReposition}
                      onContextMenu={(mapping, event) => {
                        setAssetContextMenu({
                          mapping,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      live={assetStatusLive}
                      suppressFireEffects={placingMarker}
                    />
                  );
                })}
                {assetContextMenu ? (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setAssetContextMenu(null);
                      }}
                    />
                    <div
                      className="fixed z-50 w-52 rounded-md border bg-popover p-2 shadow-lg"
                      style={{
                        left: assetContextMenu.x,
                        top: assetContextMenu.y,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p className="mb-2 truncate px-1 text-xs font-medium text-foreground">
                        {resolveAssetDeviceAddress(assetContextMenu.mapping) ||
                          assetContextMenu.mapping.assetName ||
                          "Asset"}
                      </p>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        className="w-full justify-start"
                        onClick={() => {
                          onAssetRemove?.(assetContextMenu.mapping);
                          setAssetContextMenu(null);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove from map
                      </Button>
                    </div>
                  </>
                ) : null}
              </TooltipProvider>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
