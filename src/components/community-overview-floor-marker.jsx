"use client";

import { memo } from "react";
import { getMarkerImageSrc, handleImageError } from "@/lib/assetIcons";
import {
  getAssetMarkerTooltip,
  getFireBorderColor,
  getFireDimColor,
  shouldFireRipple,
} from "@/lib/assetFireStatus";
import { useAssetFireActive } from "@/stores/assetFireStatusStore";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

function CommunityOverviewFloorMarkerInner({
  mapping,
  x,
  y,
  browserZoom,
  fallbackActive,
  live = true,
  onClick,
}) {
  const deviceAddr = resolveAssetDeviceAddress(mapping) || mapping.deviceAddress || "";
  const assetId = mapping.assetsListId || mapping.id || mapping.buildingAssetId;
  const active = useAssetFireActive(assetId, deviceAddr, fallbackActive, live);
  const markerTooltip = getAssetMarkerTooltip(mapping, {});
  const dimColor = getFireDimColor(active);
  const borderColor = getFireBorderColor(active);
  const pulse = shouldFireRipple(active);

  return (
    <div
      data-asset-marker="true"
      className="absolute z-20 cursor-pointer"
      style={{
        left: x,
        top: y,
        pointerEvents: "auto",
        transform: `translate(-50%, -50%) scale(${1 / browserZoom})`,
        transformOrigin: "center",
      }}
      title={markerTooltip}
      onClick={() => onClick(mapping)}
    >
      <div
        className="absolute rounded-full"
        style={{
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: 40,
          height: 40,
          background: dimColor,
          borderRadius: "50%",
          zIndex: -2,
          pointerEvents: "none",
        }}
      />
      {pulse ? (
        <div
          className="ripple"
          style={{
            width: 40,
            height: 40,
            zIndex: -1,
            border: `2px solid ${borderColor}`,
          }}
        />
      ) : null}
      <img
        src={getMarkerImageSrc(mapping)}
        alt={mapping.assetName || "asset"}
        title={markerTooltip}
        className="w-6 h-6 rounded-full border-2 border-white shadow-lg object-cover"
        onError={handleImageError}
      />
    </div>
  );
}

function propsAreEqual(prev, next) {
  return (
    prev.x === next.x &&
    prev.y === next.y &&
    prev.browserZoom === next.browserZoom &&
    prev.fallbackActive === next.fallbackActive &&
    prev.mapping.id === next.mapping.id &&
    prev.mapping.deviceAddress === next.mapping.deviceAddress &&
    prev.mapping.active === next.mapping.active &&
    prev.live === next.live
  );
}

export const CommunityOverviewFloorMarker = memo(
  CommunityOverviewFloorMarkerInner,
  propsAreEqual,
);
