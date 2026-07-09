"use client";

import { memo, useState } from "react";
import { resolveAssetTypeFromMapping } from "@/lib/assetIcons";
import { AssetTypeMarkerImage } from "@/components/floor-plan/asset-type-marker-image";
import {
  getFireBorderColor,
  getFireDimColor,
  getFireRadarColor,
  shouldFireRipple,
} from "@/lib/assetFireStatus";
import { useAssetFireActive } from "@/stores/assetFireStatusStore";
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
}) {
  const [dragPos, setDragPos] = useState(null);
  const isDragging = dragPos !== null;
  const displayLeft = dragPos?.left ?? left;
  const displayTop = dragPos?.top ?? top;

  const assetId = mapping.id || mapping.sanitizedId || mapping.assetsListId;
  const currentActive = useAssetFireActive(
    assetId,
    deviceAddr,
    fallbackActive,
    live && !suppressFireEffects,
  );
  const address = String(deviceAddr || "").trim();
  const location = String(deviceLocation || "").trim();
  const radarColor = suppressFireEffects ? "transparent" : getFireRadarColor(currentActive);
  const borderColor = suppressFireEffects
    ? "hsl(var(--primary))"
    : getFireBorderColor(currentActive);
  const dimColor = suppressFireEffects ? "transparent" : getFireDimColor(currentActive);
  const isOnFire = !suppressFireEffects && shouldFireRipple(currentActive);

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
          className={`absolute z-20 ${editable ? (isDragging ? "cursor-grabbing" : "cursor-grab") : "cursor-pointer"}`}
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

            {isOnFire
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
                boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
                position: "relative",
                zIndex: 1,
              }}
            >
              <AssetTypeMarkerImage
                mapping={mapping}
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
    prev.mapping.locationIndex === next.mapping.locationIndex &&
    prev.mapping.assetName === next.mapping.assetName &&
    prev.mapping.itemType === next.mapping.itemType &&
    prev.mapping.category === next.mapping.category &&
    prev.live === next.live &&
    prev.suppressFireEffects === next.suppressFireEffects &&
    prev.editable === next.editable
  );
}

export const FloorMapAssetMarker = memo(FloorMapAssetMarkerInner, propsAreEqual);
