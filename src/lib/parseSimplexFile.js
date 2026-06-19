/** Parse KEY=VALUE pairs from a Simplex device block (values may contain spaces). */
import {
  resolveSimplexDeviceAddress,
  stripNullChars,
} from "./simplexDeviceAddress";

/** Panel flags use formats like 0-, 1*, 0* — read leading digit. */
export function parseSimplexStatusDigit(raw) {
  if (raw === undefined || raw === null) return null;
  const match = stripNullChars(String(raw)).match(/^(\d)/);
  return match ? Number(match[1]) : null;
}

/** D=0* disabled off, D=1* disabled on */
export function parseSimplexDisabledFlag(raw) {
  if (raw === undefined || raw === null) return false;
  return stripNullChars(String(raw)).startsWith("1");
}

const SIMPLEX_FIELD_KEYS = [
  "CVAL",
  "PEAK",
  "ADD",
  "NAM",
  "LAB",
  "BAN",
  "DT",
  "PT",
  "F",
  "T",
  "S",
  "D",
  "C",
  "U",
];

/** Insert a space before glued KEY= tokens (e.g. PT=WSOF=0-, PEAK=0/0/0.0F=0-). */
function insertSimplexKeyBoundaries(text) {
  // Status flags after digits/symbols: F=0-, T=1*, D=0*
  let result = text.replace(
    /(?<=[0-9.*\-/)])(?=(?:F|T|S|D|C|U)=)/g,
    " ",
  );

  // Main multi-letter fields glued to prior text: MONITORDT=IAM, PT=WSOF=0-
  const mainKeys = ["CVAL", "PEAK", "ADD", "NAM", "LAB", "BAN", "DT", "PT"];
  const mainPattern = [...mainKeys].sort((a, b) => b.length - a.length).join("|");
  result = result.replace(
    new RegExp(`(?<=[A-Za-z0-9])(?=(?:${mainPattern})=)`, "g"),
    " ",
  );

  // Status flag F glued to point type: PT=WSOF=0-
  result = result.replace(/(?<=[A-Za-z]{2})(?=F=)/g, " ");

  return result;
}

function getSimplexKeyPattern() {
  return [...SIMPLEX_FIELD_KEYS].sort((a, b) => b.length - a.length).join("|");
}

/**
 * Normalize cshow text so KEY= tokens are separable.
 * Handles glued fields like PT=WSOF=0-T=1* and D=0*~M1-14.
 */
function normalizeSimplexBlockText(text) {
  return insertSimplexKeyBoundaries(
    String(text || "")
      .replace(/\0/g, "")
      .replace(/\r/g, "\n")
      .replace(/([^\s\r\n])~/g, "$1\n~"),
  );
}

function parseKeyValues(text, data) {
  const normalized = normalizeSimplexBlockText(text)
    .replace(/\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return;

  const keyPattern = getSimplexKeyPattern();
  const tokens = normalized.split(new RegExp(`\\s+(?=(?:${keyPattern})=)`));

  for (const token of tokens) {
    const eqIndex = token.indexOf("=");
    if (eqIndex === -1) continue;
    const key = token.slice(0, eqIndex).trim();
    const value = token.slice(eqIndex + 1).trim();
    if (!SIMPLEX_FIELD_KEYS.includes(key)) continue;
    data[key] = stripNullChars(value);
  }
}

function resolveStatusF(data) {
  if (data.F !== undefined) return parseSimplexStatusDigit(data.F);
  if (data.C !== undefined) return parseSimplexStatusDigit(data.C);
  if (data.U !== undefined) return parseSimplexStatusDigit(data.U);
  return null;
}

/**
 * Parse Simplex panel cshow * output into device records.
 * Supports file content (newline-separated blocks) and telnet (inline ~ blocks).
 */
export function parseSimplexFile(content) {
  const normalized = normalizeSimplexBlockText(content).replace(/cshow\s+\*/gi, "");

  const blocks = normalized
    .split(/\n(?=~)/)
    .map((b) => b.trim())
    .filter(Boolean);

  const results = [];

  for (const block of blocks) {
    const headerMatch = block.match(/^~(?:(\d+):)?M(\d+)-(\d+)(?:-(\d+))?(?:\s|$)/);
    if (!headerMatch) continue;

    const [, panelFromName, loopNumber, deviceNumber, subAddNumber] = headerMatch;
    const bodyText = block.slice(headerMatch[0].length);

    const data = {};
    parseKeyValues(bodyText, data);

    const panel =
      panelFromName ?? (data.ADD ? data.ADD.split("-")[0] : null);

    const location = data.LAB
      ? stripNullChars(
          data.LAB.replace(new RegExp(`\\s*${data.NAM}\\s*$`), "").trim(),
        )
      : "";

    const deviceAddress = resolveSimplexDeviceAddress({
      deviceAddress: stripNullChars(data.NAM),
      loopNumber,
      deviceNumber,
      subAdd: subAddNumber || 0,
    });

    results.push({
      Panel: panel ? Number(panel) : null,
      LoopNumber: Number(loopNumber),
      DeviceNumber: Number(deviceNumber),
      SubAdd: subAddNumber ? Number(subAddNumber) : 0,
      PanelAddress: stripNullChars(data.ADD || ""),
      DeviceAddress: deviceAddress,
      DeviceLocation: location,
      BAN: stripNullChars(data.BAN || ""),
      DeviceType: stripNullChars(data.DT || ""),
      PointType: stripNullChars(data.PT || ""),
      CVAL: stripNullChars(data.CVAL || ""),
      PEAK: stripNullChars(data.PEAK || ""),
      F: resolveStatusF(data),
      T: parseSimplexStatusDigit(data.T),
      S: parseSimplexStatusDigit(data.S),
      D: parseSimplexDisabledFlag(data.D),
    });
  }

  return results;
}
