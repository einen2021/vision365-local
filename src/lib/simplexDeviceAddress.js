/** Remove null bytes from panel strings (e.g. "SMOKE DETECTOR\u0000"). */
export function stripNullChars(value) {
  return String(value || "").replace(/\0/g, "").trim();
}

/** Remove leading panel id prefix e.g. "2:M1-2-1" -> "M1-2-1". */
export function stripPanelAddressPrefix(value) {
  const cleaned = stripNullChars(value);
  if (!cleaned) return "";
  return cleaned.replace(/^\d+:/i, "").trim();
}

/** Build M-address from loop / device / optional sub-address. */
export function buildSimplexMAddress(loopNumber, deviceNumber, subAdd = 0) {
  const loop = Number(loopNumber);
  const device = Number(deviceNumber);
  if (!loop || !device) return "";
  const base = `M${loop}-${device}`;
  const sub = Number(subAdd);
  if (sub > 0) return `${base}-${sub}`;
  return base;
}

const M_ADDRESS_RE = /^M\d+-\d+(?:-\d+)?$/i;

export function isSimplexMAddress(value) {
  return M_ADDRESS_RE.test(stripPanelAddressPrefix(value));
}

/**
 * Canonical Simplex device address.
 * Strips panel prefixes, prefers M-address from deviceAddress / partNumber,
 * then falls back to loop+device from the cshow header.
 */
export function resolveSimplexDeviceAddress({
  deviceAddress = "",
  partNumber = "",
  loopNumber,
  deviceNumber,
  subAdd = 0,
} = {}) {
  const candidates = [
    stripPanelAddressPrefix(deviceAddress),
    stripPanelAddressPrefix(partNumber),
    buildSimplexMAddress(loopNumber, deviceNumber, subAdd),
  ];

  for (const candidate of candidates) {
    if (isSimplexMAddress(candidate)) {
      return candidate.toUpperCase();
    }
  }

  const fallback =
    stripPanelAddressPrefix(deviceAddress) || stripPanelAddressPrefix(partNumber);
  return fallback ? fallback.toUpperCase() : "";
}

/** Resolve address from a stored AssetsList document. */
export function resolveAssetDeviceAddress(asset) {
  if (!asset || typeof asset !== "object") return "";
  return resolveSimplexDeviceAddress({
    deviceAddress: asset.deviceAddress,
    partNumber: asset.partNumber,
    loopNumber: asset.loopNumber,
    deviceNumber: asset.deviceNumber,
    subAdd: asset.subAdd,
  });
}
