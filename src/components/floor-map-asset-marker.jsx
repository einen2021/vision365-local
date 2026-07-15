"use client";

import { memo, useState } from "react";
import { resolveAssetTypeFromMapping } from "@/lib/assetIcons";
import { AssetTypeMarkerImage } from "@/components/floor-plan/asset-type-marker-image";
import {
  DISABLED_MARKER_STYLES,
  getEnabledMarkerBorderColor,
  getEnabledMarkerDimColor,
} from "@/lib/assetEnabledStatus";
import { useAssetMarkerVisualFromMapping } from "@/stores/assetFireStatusStore";
import { useIsDeviceEnabled } from "@/stores/deviceEnabledStore";
import { resolveMappingDeviceFields } from "@/lib/floorMapAssets";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  clientPointToMarkerScreenPos,
  clientPointToNaturalCoords,
} from "@/lib/nestedFloorPlan";

const MARKER_HALO_SIZE = 30;
const MARKER_ICON_SIZE = 20;
const FIRE_RIPPLE_DELAYS = ["0s", "0.6s", "1.2s"];

function FloorMapAssetMarkerInner({
  mapping,
  left,
  top,
  browserZoom,
  fallbackActive,
  deviceAddr,
  deviceLocation,
  typeIconUrl = "",
  onAssetClick,
  onReposition,
  onContextMenu,
  editable = false,
  imageRef,
  imageDims,
  live = true,
  suppressFireEffects = false,
  highlighted = false,
}) {
  const [dragPos, setDragPos] = useState(null);
  const isDragging = dragPos !== null;
  const displayLeft = dragPos?.left ?? left;
  const displayTop = dragPos?.top ?? top;

  // Resolve address from mapping fields when the parent did not pass one.
  const resolvedAddress =
    String(deviceAddr || "").trim() ||
    resolveMappingDeviceFields(mapping).deviceAddress ||
    "";
  // F/T rules: F=1 → red+ripple; F=0 T=1 → yellow; F=0 T=0 → green.
  const visual = useAssetMarkerVisualFromMapping(
    mapping,
    resolvedAddress,
    fallbackActive,
    live && !suppressFireEffects,
  );
  const address = resolvedAddress;
  const location = String(deviceLocation || "").trim();
  const mappingEnabled = mapping?.enabled !== false;
  const isDeviceEnabled = useIsDeviceEnabled(address, mappingEnabled);
  const radarColor =
    suppressFireEffects || !isDeviceEnabled ? "transparent" : visual.radarColor;
  const borderColor = getEnabledMarkerBorderColor(
    isDeviceEnabled,
    suppressFireEffects ? "hsl(var(--primary))" : visual.borderColor,
  );
  const dimColor = getEnabledMarkerDimColor(
    isDeviceEnabled,
    suppressFireEffects ? "transparent" : visual.dimColor,
  );
  // Ripple only when F=1 (fire), never for trouble-only yellow.
  const showFireRipple =
    isDeviceEnabled && !suppressFireEffects && visual.ripple;

  const handlePointerDown = (event) => {
    if (!editable || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pos = clientPointToMarkerScreenPos(
      event.clientX,
      event.clientY,
      imageRef,
      imageDims,
    );
    if (pos) setDragPos(pos);
  };

  const handlePointerMove = (event) => {
    if (!editable || !isDragging) return;
    event.preventDefault();
    const pos = clientPointToMarkerScreenPos(
      event.clientX,
      event.clientY,
      imageRef,
      imageDims,
    );
    if (pos) setDragPos(pos);
  };

  const handlePointerUp = (event) => {
    if (!editable || !isDragging) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const coords = clientPointToNaturalCoords(
      event.clientX,
      event.clientY,
      imageRef,
      imageDims,
    );
    if (coords && onReposition) {
      onReposition(mapping, coords);
    }
    setDragPos(null);
  };

  const handleContextMenu = (event) => {
    if (!editable || !onContextMenu) return;
    event.preventDefault();
    event.stopPropagation();
    onContextMenu(mapping, event);
  };

  return (
    <Tooltip open={isDragging ? false : undefined}>
      <TooltipTrigger asChild>
        <div
          className={`absolute ${highlighted ? "z-30" : "z-20"} ${editable ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer"}`}
          style={{
            left: displayLeft,
            top: displayTop,
            transform: `translate(-50%, -50%) scale(${1 / browserZoom})`,
            transformOrigin: "center",
            touchAction: editable ? "none" : "auto",
          }}
          onClick={(e) => {
            if (editable || isDragging) return;
            e.stopPropagation();
            onAssetClick?.(mapping);
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onContextMenu={handleContextMenu}
        >
          <div
            className="relative"
            style={{
              width: MARKER_HALO_SIZE,
              height: MARKER_HALO_SIZE,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {/* Search Found frame is drawn behind this marker on the canvas — do not
                paint an extra orange box here; it would cover F/T status colors. */}

            <div
              className="absolute rounded-full"
              style={{
                left: "50%",
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: MARKER_HALO_SIZE,
                height: MARKER_HALO_SIZE,
                background: dimColor,
                borderRadius: "50%",
                pointerEvents: "none",
              }}
            />

            {showFireRipple
              ? FIRE_RIPPLE_DELAYS.map((delay) => (
                  <div
                    key={delay}
                    className="fire-marker-ripple"
                    style={{
                      width: MARKER_HALO_SIZE,
                      height: MARKER_HALO_SIZE,
                      border: `2px solid ${borderColor}`,
                      background: radarColor,
                      animationDelay: delay,
                    }}
                  />
                ))
              : null}

            <div
              className="overflow-hidden rounded-full"
              style={{
                width: MARKER_ICON_SIZE,
                height: MARKER_ICON_SIZE,
                border: `2px solid ${borderColor}`,
                boxShadow: isDeviceEnabled
                  ? "0 1px 2px rgba(0,0,0,0.2)"
                  : "0 0 0 1px rgba(156,163,175,0.5)",
                position: "relative",
                zIndex: 1,
                opacity: isDeviceEnabled ? 1 : DISABLED_MARKER_STYLES.iconOpacity,
                filter: isDeviceEnabled ? undefined : DISABLED_MARKER_STYLES.iconFilter,
              }}
            >
              <AssetTypeMarkerImage
                mapping={mapping}
                typeIconUrl={typeIconUrl}
                alt={mapping.assetName || mapping.itemType || "asset"}
                className="h-full w-full object-cover"
              />
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
        {editable ? (
          <p className="text-xs text-muted-foreground">Drag to move · Right-click for options</p>
        ) : null}
        {address || location ? (
          <div className="space-y-0.5 text-left">
            {address ? (
              <p>
                <span className="font-semibold">Address:</span> {address}
              </p>
            ) : null}
            {location ? (
              <p>
                <span className="font-semibold">Location:</span> {location}
              </p>
            ) : null}
            <p>
              <span className="font-semibold">Status:</span>{" "}
              <span className={isDeviceEnabled ? "text-green-600" : "text-red-600"}>
                {isDeviceEnabled ? "Enabled" : "Disabled"}
              </span>
            </p>
          </div>
        ) : (
          mapping.assetName || "Asset"
        )}
      </TooltipContent>
    </Tooltip>
  );
}

function propsAreEqual(prev, next) {
  return (
    prev.left === next.left &&
    prev.top === next.top &&
    prev.browserZoom === next.browserZoom &&
    prev.fallbackActive === next.fallbackActive &&
    prev.deviceAddr === next.deviceAddr &&
    prev.deviceLocation === next.deviceLocation &&
    prev.typeIconUrl === next.typeIconUrl &&
    prev.mapping.id === next.mapping.id &&
    prev.mapping.assetsListId === next.mapping.assetsListId &&
    prev.mapping.buildingAssetId === next.mapping.buildingAssetId &&
    prev.mapping.deviceAddress === next.mapping.deviceAddress &&
    prev.mapping.locationIndex === next.mapping.locationIndex &&
    prev.mapping.assetName === next.mapping.assetName &&
    prev.mapping.itemType === next.mapping.itemType &&
    prev.mapping.customImageUrl === next.mapping.customImageUrl &&
    prev.mapping.category === next.mapping.category &&
    prev.mapping.enabled === next.mapping.enabled &&
    prev.live === next.live &&
    prev.suppressFireEffects === next.suppressFireEffects &&
    prev.editable === next.editable &&
    prev.highlighted === next.highlighted
  );
}

export const FloorMapAssetMarker = memo(FloorMapAssetMarkerInner, propsAreEqual);
