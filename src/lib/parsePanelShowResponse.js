/** Parse `show <address>` telnet output from the fire panel. */

/**
 * Simplex panels often pad columns with NUL bytes instead of spaces.
 * Replace NULs with spaces so LABEL/value matching works in desktop telnet.
 */
function sanitizePanelShowText(text = "") {
  return String(text || "")
    .replace(/\0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

/** Normalize telnet line endings so field matching is reliable. */
function normalizeShowText(text = "") {
  return sanitizePanelShowText(text);
}

/** Match `LABEL: value` or space-separated `LABEL value` lines. */
function matchShowField(raw, label) {
  const escaped = String(label).replace(/\s+/g, "\\s+");
  // Prefer colon form, then any whitespace-separated value on the same line.
  const withColon = new RegExp(`${escaped}\\s*:\\s*(\\S[^\\n]*)`, "i");
  const spaced = new RegExp(`${escaped}\\s+(\\S[^\\n]*)`, "i");
  const match = raw.match(withColon) || raw.match(spaced);
  return match ? match[1].trim() : "";
}

export const PRIMARY_STATUS_TYPES = [
  "NORMAL",
  "FIRE ALARM",
  "DIRTY",
  "DISABLE TROUBLE",
  "DISABLE ALARM",
  "ABNORMAL",
  "NO ANSWER",
  "SUPERVISORY",
  "OPEN",
  "SHORT",
  "TEST",
  "UNVERIFIED",
  "ACTIVE",
  "INACTIVE",
  "OFF",
  "ON",
];

export function resolvePrimaryStatusType(rawStatus = "") {
  const trimmed = String(rawStatus || "").trim().toUpperCase();
  if (!trimmed) return "";

  // 1. Direct exact match
  const exact = PRIMARY_STATUS_TYPES.find((t) => t === trimmed);
  if (exact) return exact;

  // 2. Specific prefix rules
  if (/^DISA/i.test(trimmed)) {
    if (/ALARM/i.test(trimmed)) return "DISABLE ALARM";
    return "DISABLE TROUBLE";
  }
  if (/^NORM/i.test(trimmed)) return "NORMAL";
  if (/^FIRE|^ALARM/i.test(trimmed)) return "FIRE ALARM";
  if (/^DIRT/i.test(trimmed)) return "DIRTY";
  if (/^ABNOR/i.test(trimmed)) return "ABNORMAL";
  if (/^NO\s*ANS/i.test(trimmed)) return "NO ANSWER";
  if (/^SUP/i.test(trimmed)) return "SUPERVISORY";
  if (/^UNVER/i.test(trimmed)) return "UNVERIFIED";

  // 3. Prefix matching from candidate list
  if (trimmed.length >= 2) {
    const candidate = PRIMARY_STATUS_TYPES.find((t) => t.startsWith(trimmed));
    if (candidate) return candidate;
  }

  return trimmed;
}

export function parsePanelShowResponse(text = "") {
  const raw = normalizeShowText(text);

  const rawPrimaryStatus = matchShowField(raw, "PRIMARY STATUS");
  const primaryStatus = resolvePrimaryStatusType(rawPrimaryStatus);
  const rawEnabledState = matchShowField(raw, "ENABLED STATE");
  const enabledState =
    rawEnabledState ||
    (primaryStatus.startsWith("DISABLE") ? "DISABLED" : "");

  const primaryUpper = primaryStatus.toUpperCase();
  const enabledUpper = enabledState.toUpperCase();

  // PRIMARY STATUS reports "DISABLE ..." (e.g. DISABLE TROUBLE, DISABLE ALARM) when
  // the point itself is disabled — treat that the same as ENABLED STATE: DISABLED.
  const stateIndicatesDisabled = /\bDISABLE/.test(primaryUpper);
  const stateIndicatesEnabled = /\bENABLE/.test(primaryUpper) && !stateIndicatesDisabled;

  let enabled = null;
  if (enabledUpper.includes("DISABLED") || stateIndicatesDisabled) {
    enabled = false;
  } else if (enabledUpper.includes("ENABLED") || stateIndicatesEnabled) {
    enabled = true;
  }

  return {
    primaryStatus,
    enabledState,
    enabled,
  };
}

/** Map panel PRIMARY STATUS text to simplex F/T/S flags for floor markers. */
export function primaryStatusToSimplex(primaryStatus = "") {
  const status = String(primaryStatus || "").toUpperCase();

  if (/FIRE\s*ALARM|\bALARM\b/.test(status)) {
    return { F: 1, T: 0, S: 0 };
  }
  if (/TROUBLE|DIRTY|DISABLE\s+TROUBLE|ABNORMAL|NO\s+ANSWER|OPEN|SHORT/.test(status)) {
    return { F: 0, T: 1, S: 0 };
  }
  if (/SUPERVISORY|SUPV|SUPR/.test(status)) {
    return { F: 0, T: 0, S: 1 };
  }

  return { F: 0, T: 0, S: 0 };
}

/** UI tone for PRIMARY STATUS badge. */
export function getPrimaryStatusTone(primaryStatus = "") {
  const status = String(primaryStatus || "").toUpperCase();

  if (/FIRE\s*ALARM|\bALARM\b/.test(status)) return "fire";
  if (/TROUBLE|DIRTY|DISABLE\s+TROUBLE|ABNORMAL|NO\s+ANSWER|OPEN|SHORT/.test(status)) return "trouble";
  if (/SUPERVISORY|SUPV|SUPR/.test(status)) return "supervisory";
  if (/NORMAL|OFF|INACTIVE/.test(status)) return "normal";
  return "unknown";
}
