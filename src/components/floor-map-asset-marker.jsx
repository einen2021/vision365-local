"use client";

import { memo } from "react";
import { getMarkerImageSrc, handleImageError } from "@/lib/assetIcons";
import { useAssetTypeIcons } from "@/contexts/AssetTypeIconsContext";
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
  customImageUrl,
  onAssetClick,
  live = true,
}) {
  const { overrides } = useAssetTypeIcons();
  const assetId = mapping.id || mapping.sanitizedId || mapping.assetsListId;
  const currentActive = useAssetFireActive(assetId, deviceAddr, fallbackActive, live);
  const address = String(deviceAddr || "").trim();
  const location = String(deviceLocation || "").trim();
  const radarColor = getFireRadarColor(currentActive);
  const borderColor = getFireBorderColor(currentActive);
  const dimColor = getFireDimColor(currentActive);
  const isOnFire = shouldFireRipple(currentActive);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="absolute z-20 cursor-pointer"
          style={{
            left,
            top,
            transform: `translate(-50%, -50%) scale(${1 / browserZoom})`,
            transformOrigin: "center",
          }}
          onClick={(e) => {
            e.stopPropagation();
            onAssetClick?.(mapping);
          }}
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
              <img
                src={getMarkerImageSrc({ ...mapping, customImageUrl }, overrides)}
                alt={mapping.assetName || mapping.itemType || "asset"}
                className="h-full w-full object-cover"
                onError={handleImageError}
              />
            </div>
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px]">
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
    prev.customImageUrl === next.customImageUrl &&
    prev.mapping.id === next.mapping.id &&
    prev.mapping.locationIndex === next.mapping.locationIndex &&
    prev.mapping.assetName === next.mapping.assetName &&
    prev.mapping.itemType === next.mapping.itemType &&
    prev.mapping.category === next.mapping.category &&
    prev.live === next.live
  );
}

export const FloorMapAssetMarker = memo(FloorMapAssetMarkerInner, propsAreEqual);
