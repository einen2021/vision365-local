"use client";

import { memo } from "react";
import { getIconForCategory, handleImageError } from "@/lib/assetIcons";
import {
  getAssetMarkerTooltip,
  getFireBorderColor,
  getFireDimColor,
  getFireRadarColor,
  shouldFireRipple,
} from "@/lib/assetFireStatus";
import { useAssetFireActive } from "@/stores/assetFireStatusStore";

const MARKER_HALO_SIZE = 30;
const MARKER_ICON_SIZE = 16;
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
  const assetId = mapping.id || mapping.sanitizedId || mapping.assetsListId;
  const currentActive = useAssetFireActive(assetId, deviceAddr, fallbackActive, live);
  const markerTooltip = getAssetMarkerTooltip(
    {
      ...mapping,
      deviceLocation,
      deviceAddress: deviceAddr,
    },
    {},
  );
  const radarColor = getFireRadarColor(currentActive);
  const borderColor = getFireBorderColor(currentActive);
  const dimColor = getFireDimColor(currentActive);
  const isOnFire = shouldFireRipple(currentActive);

  return (
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
      title={markerTooltip}
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
          style={{
            width: MARKER_ICON_SIZE,
            height: MARKER_ICON_SIZE,
            borderRadius: "50%",
            background: "#ffffff",
            border: `2px solid ${borderColor}`,
            boxShadow: "0 1px 2px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            zIndex: 1,
          }}
        >
          <img
            src={getIconForCategory(mapping.category, customImageUrl)}
            alt={mapping.assetName || "asset"}
            title={markerTooltip}
            className="h-3.5 w-3.5 object-contain rounded-full"
            onError={handleImageError}
          />
        </div>
      </div>
    </div>
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
    prev.mapping.category === next.mapping.category &&
    prev.live === next.live
  );
}

export const FloorMapAssetMarker = memo(FloorMapAssetMarkerInner, propsAreEqual);
