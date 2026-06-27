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

const M_ADDRESS_RE = /^M\d+-\d+(?:-\d+)?$/i;
const PANEL_M_ADDRESS_RE = /^(?:(\d+):)?(M\d+-\d+(?:-\d+)?)$/i;

/** Parse a Simplex address token, keeping panel prefix when present. */
export function parseSimplexAddressToken(value) {
  const cleaned = stripNullChars(value);
  if (!cleaned) return null;

  const match = cleaned.match(PANEL_M_ADDRESS_RE);
  if (!match) return null;

  const [, panel, mAddress] = match;
  const normalizedM = mAddress.toUpperCase();
  return {
    panel: panel || null,
    mAddress: normalizedM,
    full: panel ? `${panel}:${normalizedM}` : normalizedM,
  };
}

/** Build M-address from loop / device / optional sub-address. */
export function buildSimplexMAddress(loopNumber, deviceNumber, subAdd = 0, includeZeroSubAdd = false) {
  const loop = Number(loopNumber);
  const device = Number(deviceNumber);
  if (!loop || !device) return "";
  const base = `M${loop}-${device}`;
  const sub = Number(subAdd);
  if (sub > 0 || (includeZeroSubAdd && sub === 0)) {
    return `${base}-${sub}`;
  }
  return base;
}

export function isSimplexMAddress(value) {
  return M_ADDRESS_RE.test(stripPanelAddressPrefix(value));
}

function attachPanelPrefix(panel, mAddress) {
  const normalized = String(mAddress || "").trim().toUpperCase();
  if (!normalized) return "";
  const panelId = stripNullChars(panel);
  if (!panelId) return normalized;
  return `${panelId}:${normalized}`;
}

/**
 * Canonical Simplex device address.
 * Keeps panel prefix when present (e.g. 2:M1-2-0). Attaches panel from context when known.
 */
export function resolveSimplexDeviceAddress({
  deviceAddress = "",
  partNumber = "",
  loopNumber,
  deviceNumber,
  subAdd = 0,
  panel = null,
  includeZeroSubAdd = false,
} = {}) {
  for (const raw of [deviceAddress, partNumber]) {
    const parsed = parseSimplexAddressToken(raw);
    if (!parsed) continue;
    if (parsed.panel) return parsed.full;
    return attachPanelPrefix(panel, parsed.mAddress);
  }

  const built = buildSimplexMAddress(loopNumber, deviceNumber, subAdd, includeZeroSubAdd);
  if (built) {
    return attachPanelPrefix(panel, built.toUpperCase());
  }

  const fallback =
    stripPanelAddressPrefix(deviceAddress) || stripPanelAddressPrefix(partNumber);
  if (!fallback) return "";
  return attachPanelPrefix(panel, fallback);
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
    panel: asset.panel ?? asset.Panel ?? null,
    includeZeroSubAdd:
      Number(asset.subAdd) === 0 &&
      /-\d+$/i.test(stripPanelAddressPrefix(asset.deviceAddress || asset.partNumber || "")),
  });
}
