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

const getRadarColor = getFireRadarColor;
const getDimColor = getFireDimColor;
const getRadarBorderColor = getFireBorderColor;
const shouldAnimate = shouldFireRipple;

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
  const radarColor = getRadarColor(currentActive);
  const borderColor = getRadarBorderColor(currentActive);
  const dimColor = getDimColor(currentActive);
  const pulseHigh = shouldAnimate(currentActive);

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
          width: 44,
          height: 44,
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
            width: 44,
            height: 44,
            background: dimColor,
            borderRadius: "50%",
            pointerEvents: "none",
          }}
        />

        {pulseHigh ? (
          <div
            className="absolute rounded-full"
            style={{
              left: "50%",
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: 44,
              height: 44,
              background: radarColor,
              borderRadius: "50%",
              animation: "radar-pulse 1.8s infinite",
              opacity: 0.9,
            }}
          />
        ) : null}

        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            background: "#ffffff",
            border: `2px solid ${borderColor}`,
            boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={getIconForCategory(mapping.category, customImageUrl)}
            alt={mapping.assetName || "asset"}
            title={markerTooltip}
            className="w-5 h-5 object-contain rounded-full"
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
