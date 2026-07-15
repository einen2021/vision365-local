/** Shared constants and parsers for fire-panel CVAL monitoring. */

export const PANEL_STATE_REFRESH_MS = 5000;
export const MONITOR_INTERVAL_MS = 500;
/** Large trouble lists (200+) need well over 15s before the panel sends _DNE. */
export const LIST_COMMAND_TIMEOUT_MS = 120000;

export const CVAL_COMMANDS = [
  { label: "Fire", cmd: "cshow a0 cval", field: "totalFire", listCmd: "list f" },
  {
    label: "Supervisory",
    cmd: "cshow a1 cval",
    field: "totalSupervisory",
    listCmd: "list s",
  },
  { label: "Trouble", cmd: "cshow a2 cval", field: "totalTrouble", listCmd: "list t" },
];

export function isListResponseComplete(response) {
  return /_DNE|_END\b/i.test(String(response || "").replace(/\0/g, " "));
}

/**
 * Parse CVAL from panel response. Accepts partial/garbled telnet output as long as
 * CVAL=<number> is present (strict full-line regex was failing on desktop).
 */
export function extractCVal(response, expectedCmd = "") {
  const text = String(response || "").replace(/\0/g, " ");
  const cvalMatch = text.match(/CVAL\s*=\s*(\d+)/i);
  if (!cvalMatch) return null;

  const panelMatch = text.match(/~A\s*([012])/i);
  const cmdMatch = String(expectedCmd).match(/a([012])/i);

  return {
    command: String(expectedCmd || cvalMatch.input || "").toLowerCase(),
    panel: panelMatch ? Number(panelMatch[1]) : cmdMatch ? Number(cmdMatch[1]) : 0,
    cval: Number(cvalMatch[1]),
  };
}

/** Map monitor category label to simplexStatus key (F / T / S). */
export function simplexKeyForCategoryLabel(label) {
  if (label === "Trouble") return "T";
  if (label === "Supervisory") return "S";
  return "F";
}

/** Parse panel list command output into unique device addresses. */
export function extractPanelDeviceAddresses(response) {
  const regex = /\b\d+:M\d+-\d+(?:-\d+)?\b/gi;
  const matches = String(response || "").replace(/\0/g, " ").match(regex) ?? [];
  return [...new Set(matches.map((value) => value.trim()))];
}

/** Known device type suffixes in panel list output (longest first). */
const PANEL_DEVICE_TYPES = [
  "SMOKE DETECTOR",
  "HEAT DETECTOR",
  "DUCT DETECTOR",
  "BEAM DETECTOR",
  "PULL STATION",
  "MANUAL STATION",
  "WATER FLOW",
  "FLOW SWITCH",
  "MONITOR MODULE",
  "CONTROL MODULE",
  "RELAY MODULE",
  "HORN STROBE",
  "SPEAKER STROBE",
  "HEAT DETECTOR",
  "TAMPER SWITCH",
  "GATE VALVE",
  "HORN",
  "STROBE",
  "SPEAKER",
  "MODULE",
  "DETECTOR",
  "STATION",
];

/** Strip echoed list command text that can appear mid-response. */
function stripListCommandEcho(line) {
  return String(line || "")
    // Simplex pads columns with NUL bytes — treat them as spaces so regex can match.
    .replace(/\0/g, " ")
    .replace(/^list\s+[fts]\s*/i, "")
    .replace(/^list\s+[fts](?=\d*:?M\d)/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse one panel list line into structured fields. */
function parsePanelListLine(line) {
  const trimmed = stripListCommandEcho(line);
  if (!trimmed) return null;
  if (/_DNE|_END\b/i.test(trimmed)) return null;
  if (/^list\s/i.test(trimmed)) return null;

  // Address may be followed by spaces OR leftover padding after NUL→space cleanup.
  const match = trimmed.match(/^(?:(\d+):)?(M\d+-\d+(?:-\d+)?)\s+(.+)$/i);
  if (!match) return null;

  const node = match[1] || "";
  const deviceAddress = match[2].toUpperCase();
  const fullAddress = node ? `${node}:${deviceAddress}` : deviceAddress;
  let remainder = match[3].trim();
  let panelTimeText = "";

  const leadingDateTime = remainder.match(
    /^(\d{1,2}-[A-Za-z]{3}-\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s+/,
  );
  const leadingTime = remainder.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+/);

  if (leadingDateTime) {
    panelTimeText = leadingDateTime[1];
    remainder = remainder.slice(leadingDateTime[0].length).trim();
  } else if (leadingTime) {
    panelTimeText = leadingTime[1];
    remainder = remainder.slice(leadingTime[0].length).trim();
  }

  const statusMatch = remainder.match(/\s([A-Z]{2,6}\*?)\s*$/i);
  const status = statusMatch ? statusMatch[1].toUpperCase() : "";
  if (statusMatch) {
    remainder = remainder.slice(0, statusMatch.index).trim();
  }

  if (!panelTimeText) {
    const trailingDateTime = remainder.match(
      /\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)\s*$/,
    );
    const trailingTime = remainder.match(/\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$/);
    if (trailingDateTime) {
      panelTimeText = trailingDateTime[1];
      remainder = remainder.slice(0, trailingDateTime.index).trim();
    } else if (trailingTime) {
      panelTimeText = trailingTime[1];
      remainder = remainder.slice(0, trailingTime.index).trim();
    }
  }

  let deviceType = "";
  let location = remainder;
  const upperRemainder = remainder.toUpperCase();

  for (const type of PANEL_DEVICE_TYPES) {
    if (upperRemainder.endsWith(type)) {
      deviceType = type;
      location = remainder.slice(0, remainder.length - type.length).trim();
      break;
    }
  }

  if (!deviceType && remainder) {
    const words = remainder.split(/\s+/);
    if (words.length >= 2) {
      deviceType = words.slice(-2).join(" ").toUpperCase();
      location = words.slice(0, -2).join(" ");
    } else {
      deviceType = remainder.toUpperCase();
      location = "";
    }
  }

  return {
    fullAddress,
    deviceAddress,
    location,
    deviceType,
    status,
    label: status.replace(/\*$/, ""),
    panelTimeText,
    // Exact panel line — compare against liveFire / liveTrouble / liveSupervisory history.
    raw: trimmed,
    rawMessage: trimmed,
  };
}

/** Format a timestamp for live panel list rows. */
export function formatPanelListTime(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /[A-Za-z]/.test(value) && value.includes("-")) {
    // Keep panel date strings like 12-JUL-26 readable as-is when Date parse fails.
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toLocaleString();
    return value;
  }
  const ms =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : NaN;
  if (!Number.isFinite(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

/** Parse panel `list f|t|s` text into display rows. */
export function parsePanelListResponse(text) {
  const entries = [];
  // Normalize NULs before splitting so a padded "line" stays one logical row.
  const normalized = String(text || "").replace(/\0/g, " ");

  for (const line of normalized.split(/\r?\n/)) {
    const parsed = parsePanelListLine(line);
    if (parsed) entries.push(parsed);
  }

  return entries;
}

/** How many list messages (device rows) are in a list f/t/s dump. */
export function countListMessages(response) {
  return parsePanelListResponse(response).length;
}

/** Read totalFire / totalTrouble / totalSupervisory for a list label. */
export function getExpectedListCountForLabel(label, panelState) {
  const entry = CVAL_COMMANDS.find((item) => item.label === label);
  if (!entry || !panelState) return null;
  const n = Number(panelState[entry.field]);
  return Number.isFinite(n) ? n : null;
}

/**
 * List dump is ready when:
 * - expectedCount is 0 (cleared), or
 * - message count is at/near the CVAL total, or
 * - panel sent _DNE/_END
 */
export function isListResponseReady(response, expectedCount) {
  if (expectedCount === 0) return true;
  if (isListResponseComplete(response)) return true;
  if (expectedCount != null && Number.isFinite(expectedCount) && expectedCount > 0) {
    // "Around" CVAL: accept when we have at least the panel total.
    return countListMessages(response) >= expectedCount;
  }
  return false;
}

export function getListCmdForLabel(label) {
  const entry = CVAL_COMMANDS.find((item) => item.label === label);
  return entry?.listCmd ?? null;
}

const ACK_TYPE_BY_LABEL = {
  Fire: "f",
  Trouble: "t",
  Supervisory: "s",
};

/** Build panel acknowledge command for a category or a specific list row. */
export function buildPanelAckCommand(label, deviceAddress = null) {
  const type = ACK_TYPE_BY_LABEL[label];
  if (!type) {
    throw new Error(`Unknown acknowledge type: ${label}`);
  }

  const address = String(deviceAddress || "").trim();
  if (address) {
    return `ack ${type} ${address}`;
  }

  return `ack ${type}`;
}

export function readSimplexStatus(asset) {
  const raw = asset?.simplexStatus;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return {
      F: Number(raw.F ?? 0),
      T: Number(raw.T ?? 0),
      S: Number(raw.S ?? 0),
    };
  }
  return { F: 0, T: 0, S: 0 };
}
