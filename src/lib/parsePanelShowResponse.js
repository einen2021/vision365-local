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

export function parsePanelShowResponse(text = "") {
  const raw = normalizeShowText(text);

  const primaryStatus = matchShowField(raw, "PRIMARY STATUS");
  const enabledState = matchShowField(raw, "ENABLED STATE");

  let enabled = null;
  const enabledUpper = enabledState.toUpperCase();
  if (enabledUpper.includes("DISABLED")) {
    enabled = false;
  } else if (enabledUpper.includes("ENABLED")) {
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
  if (/TROUBLE/.test(status)) {
    return { F: 0, T: 1, S: 0 };
  }
  if (/SUPERVISORY/.test(status)) {
    return { F: 0, T: 0, S: 1 };
  }

  return { F: 0, T: 0, S: 0 };
}

/** UI tone for PRIMARY STATUS badge. */
export function getPrimaryStatusTone(primaryStatus = "") {
  const status = String(primaryStatus || "").toUpperCase();

  if (/FIRE\s*ALARM|\bALARM\b/.test(status)) return "fire";
  if (/TROUBLE/.test(status)) return "trouble";
  if (/SUPERVISORY/.test(status)) return "supervisory";
  if (/NORMAL|OFF|INACTIVE/.test(status)) return "normal";
  return "unknown";
}
