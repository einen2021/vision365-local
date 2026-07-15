"use client";

import { memo } from "react";
import { AssetTypeMarkerImage } from "@/components/floor-plan/asset-type-marker-image";
import {
  getAssetMarkerTooltip,
  getFireBorderColor,
  getFireDimColor,
  shouldFireRipple,
} from "@/lib/assetFireStatus";
import {
  DISABLED_MARKER_STYLES,
  getEnabledMarkerBorderColor,
  getEnabledMarkerDimColor,
} from "@/lib/assetEnabledStatus";
import { useAssetFireActive } from "@/stores/assetFireStatusStore";
import { useIsDeviceEnabled } from "@/stores/deviceEnabledStore";
import { resolveAssetDeviceAddress } from "@/lib/simplexDeviceAddress";

function CommunityOverviewFloorMarkerInner({
  mapping,
  x,
  y,
  browserZoom,
  fallbackActive,
  typeIconUrl = "",
  live = true,
  onClick,
}) {
  const deviceAddr = resolveAssetDeviceAddress(mapping) || mapping.deviceAddress || "";
  const assetId = mapping.assetsListId || mapping.id || mapping.buildingAssetId;
  const active = useAssetFireActive(assetId, deviceAddr, fallbackActive, live);
  const mappingEnabled = mapping?.enabled !== false;
  const isDeviceEnabled = useIsDeviceEnabled(deviceAddr, mappingEnabled);
  const markerTooltip = getAssetMarkerTooltip(mapping, {});
  const dimColor = getEnabledMarkerDimColor(isDeviceEnabled, getFireDimColor(active));
  const borderColor = getEnabledMarkerBorderColor(isDeviceEnabled, getFireBorderColor(active));
  const pulse = isDeviceEnabled && shouldFireRipple(active);

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
      <AssetTypeMarkerImage
        mapping={mapping}
        typeIconUrl={typeIconUrl}
        alt={mapping.assetName || "asset"}
        className="w-6 h-6 rounded-full border-2 shadow-lg object-cover"
        style={{
          borderColor: isDeviceEnabled ? "#ffffff" : DISABLED_MARKER_STYLES.borderColor,
          opacity: isDeviceEnabled ? 1 : DISABLED_MARKER_STYLES.iconOpacity,
          filter: isDeviceEnabled ? undefined : DISABLED_MARKER_STYLES.iconFilter,
        }}
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
    prev.mapping.customImageUrl === next.mapping.customImageUrl &&
    prev.typeIconUrl === next.typeIconUrl &&
    prev.mapping.enabled === next.mapping.enabled &&
    prev.mapping.active === next.mapping.active &&
    prev.live === next.live
  );
}

export const CommunityOverviewFloorMarker = memo(
  CommunityOverviewFloorMarkerInner,
  propsAreEqual,
);
