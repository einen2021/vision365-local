/** Visual styles for enabled vs disabled floor-map markers. */

export const DISABLED_MARKER_STYLES = {
  borderColor: "#9ca3af",
  dimColor: "rgba(156, 163, 175, 0.4)",
  iconOpacity: 0.5,
  iconFilter: "grayscale(1)",
};

export function getEnabledMarkerBorderColor(isEnabled, activeBorderColor) {
  return isEnabled ? activeBorderColor : DISABLED_MARKER_STYLES.borderColor;
}

export function getEnabledMarkerDimColor(isEnabled, activeDimColor) {
  return isEnabled ? activeDimColor : DISABLED_MARKER_STYLES.dimColor;
}
