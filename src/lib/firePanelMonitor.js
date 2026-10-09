/** Shared constants and parsers for fire-panel CVAL monitoring. */

export const PANEL_STATE_REFRESH_MS = 5000;
/**
 * Soft wait for list f/t/s: keep listening until a real list message dump ends
 * with the panel prompt ("\n -") or _DNE. Soft timer resets on each telnet chunk.
 */
export const LIST_COMMAND_TIMEOUT_MS = 30000;

/**
 * A real list f / list t / list s message line, for example:
 *   1:M1-1-0   SUB BASEMENT CORRIDOR 1           SMOKE DETECTOR       FIRE*
 *   2:M1-202-0 SUB BS PMP RM WET RSR VA TUB31 SB/L1/202  SUPERVISORY MONITOR  TRBL
 */
export const LIST_MESSAGE_LINE_RE =
  /\b(?:\d+:)?M\d+-\d+(?:-\d+)?\s+\S+/i;

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

/**
 * Panel ends a list dump with a prompt line that is only "-" (after newline),
 * or with _DNE/_END. Do not treat hyphens inside addresses/locations as the end.
 */
export function isListResponseComplete(response) {
  const text = String(response || "")
    .replace(/\0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (/_DNE|_END\b/i.test(text)) return true;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  return lines[lines.length - 1] === "-";
}

/**
 * True when we have list message lines, or an empty finished dump (_DNE / "-").
 * Partial streams with rows are also valid so the UI can show them one by one.
 */
export function isValidListCommandResponse(response) {
  const text = String(response || "").replace(/\0/g, " ");
  if (!text.trim()) return false;
  if (LIST_MESSAGE_LINE_RE.test(text) || countListMessages(text) > 0) return true;
  return isListResponseComplete(text);
}

/**
 * Dump is finished when the last line is the "-" prompt / _DNE, or (when
 * expectedCount is known) we already have that many message rows.
 */
export function isListDumpFinished(response, expectedCount = null) {
  const count = countListMessages(response);
  if (
    expectedCount != null &&
    Number.isFinite(Number(expectedCount)) &&
    Number(expectedCount) > 0
  ) {
    return count >= Number(expectedCount);
  }
  return isListResponseComplete(response);
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

/**
 * Parse panel list command output into unique device addresses.
 * Reuses the same row parser as the display list (parsePanelListResponse) so
 * every address format it recognizes (M-address, P-address, bare loop-device)
 * is included here too — otherwise devices using those formats parse fine for
 * display but silently drop out of F/T/S status sync.
 */
export function extractPanelDeviceAddresses(response) {
  const addresses = parsePanelListResponse(response)
    .map((row) => String(row.fullAddress || row.deviceAddress || "").trim().toUpperCase())
    .filter(Boolean);
  return [...new Set(addresses)];
}

/** Known device type suffixes in panel list output (longest first). */
const PANEL_DEVICE_TYPES = [
  "SUPERVISORY MONITOR",
  "SYSTEM POWER SUPPLY",
  "POWER SUPPLY",
  "IDNET CARD",
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
  "AUXILIARY RELAY",
  "ALARM RELAY",
  "TROUBLE POINT",
  "HORN STROBE",
  "SPEAKER STROBE",
  "TAMPER SWITCH",
  "GATE VALVE",
  "FIRE MONITOR",
  "SUPERVISORY",
  "MONITOR ZN",
  "HORN",
  "STROBE",
  "SPEAKER",
  "MODULE",
  "DETECTOR",
  "STATION",
  "RELAY",
  "SWITCH",
  "VALVE",
];

const KNOWN_STATUS_TOKENS = new Set([
  "TRBL",
  "TRBL*",
  "TROUBLE",
  "TROUBLE*",
  "FIRE",
  "FIRE*",
  "ALARM",
  "ALARM*",
  "SUPV",
  "SUPV*",
  "SUPERVISORY",
  "SUPERVISORY*",
  "PRI2",
  "PRI2*",
  "DISABLE",
  "DISABLED",
  "DISAB",
  "NORMAL",
  "NORMAL*",
  "ACKED",
  "TEST",
  "OPEN",
  "SHORT",
  "ACTIVE",
  "OFF",
  "ON",
]);

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

/**
 * Robust extractor for panel event time from raw text or structured event entry.
 * Extracts time only (e.g. "1:49:24 am" / "12:00:00 pm") and applies it to the current date.
 *
 * @param {Object|string|number} entry
 * @returns {{ timeMs: number, timestampIso: string, panelTimeText: string }}
 */
export function extractPanelEventTime(entry) {
  const now = new Date();
  const nowMs = now.getTime();

  if (!entry) {
    return {
      timeMs: nowMs,
      timestampIso: now.toISOString(),
      panelTimeText: "",
    };
  }

  // 1. If entry is directly a numeric timestamp
  if (typeof entry === "number" && entry > 946684800000) {
    const d = new Date(entry);
    return {
      timeMs: entry,
      timestampIso: d.toISOString(),
      panelTimeText: d.toLocaleTimeString(),
    };
  }

  const rawText =
    typeof entry === "string"
      ? entry
      : String(entry.raw || entry.rawMessage || entry.message || "");

  let extractedTimeStr =
    typeof entry === "object" && typeof entry?.time === "string" ? entry.time.trim() : "";
  let extractedPanelTimeText =
    typeof entry === "object" && typeof entry?.panelTimeText === "string"
      ? entry.panelTimeText.trim()
      : "";

  // 2. Check entry.time if it's already a numeric timestamp
  if (typeof entry === "object" && typeof entry?.time === "number" && entry.time > 946684800000) {
    const d = new Date(entry.time);
    return {
      timeMs: entry.time,
      timestampIso: d.toISOString(),
      panelTimeText: extractedPanelTimeText || d.toLocaleTimeString(),
    };
  }

  // 3. Extract time string from rawText or entry if not yet provided
  if (!extractedTimeStr) {
    // Pattern A: "1:49:24 am" / "12:00:00 pm"
    const matchTimeAmPm = rawText.match(/(\d{1,2}:\d{2}(?::\d{2})?\s*[ap]m)/i);
    if (matchTimeAmPm) {
      extractedTimeStr = matchTimeAmPm[1].trim();
    } else {
      // Pattern B: 24h format "14:49:24" / "01:49:24"
      const match24 = rawText.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
      if (match24) {
        extractedTimeStr = match24[1].trim();
      }
    }
  }

  // Build human-readable panelTimeText (time only)
  const panelTimeText = extractedPanelTimeText || extractedTimeStr || now.toLocaleTimeString();

  // 4. Calculate timeMs from extracted time applied to today's date
  let timeMs = null;
  if (extractedTimeStr) {
    const matchTime = extractedTimeStr.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap]m))?$/i);
    if (matchTime) {
      let hours = parseInt(matchTime[1], 10);
      const minutes = parseInt(matchTime[2], 10);
      const seconds = matchTime[3] ? parseInt(matchTime[3], 10) : 0;
      const ampm = matchTime[4] ? matchTime[4].toLowerCase() : null;

      if (ampm === "pm" && hours < 12) hours += 12;
      if (ampm === "am" && hours === 12) hours = 0;

      const d = new Date();
      d.setHours(hours, minutes, seconds, 0);
      timeMs = d.getTime();
    }
  }

  // Fallback to entry.at / timestamp if valid
  if (!timeMs && typeof entry === "object") {
    const candidateAt = entry.at || (typeof entry.timestamp === "string" ? entry.timestamp : null);
    if (candidateAt) {
      const parsedAt = Date.parse(candidateAt);
      if (Number.isFinite(parsedAt)) {
        timeMs = parsedAt;
      }
    }
  }

  if (!timeMs || !Number.isFinite(timeMs)) {
    timeMs = nowMs;
  }

  return {
    timeMs,
    timestampIso: new Date(timeMs).toISOString(),
    panelTimeText,
  };
}

/** Parse one panel list line into structured fields. */
export function parsePanelListLine(line) {
  const trimmed = stripListCommandEcho(line);
  if (!trimmed) return null;
  if (/_DNE|_END\b/i.test(trimmed)) return null;
  if (trimmed === "-") return null;
  if (/^list\s/i.test(trimmed)) return null;
  if (/FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+|PRIORITY2\s*=\s*\d+/i.test(trimmed)) return null;
  if (/^show\s+counts/i.test(trimmed)) return null;

  // Address may stand alone, or be followed by location / type / status text.
  // Trailing spaces from NUL padding are fine — do not require extra fields.
  const match = trimmed.match(/^(?:(\d+):)?(M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+|\d+-\d+(?:-\d+)?)(?:\s+(.*))?$/i);
  if (!match) return null;

  const node = match[1] || "";
  const deviceAddress = match[2].toUpperCase();
  const fullAddress = node ? `${node}:${deviceAddress}` : deviceAddress;
  let remainder = String(match[3] || "").trim();
  let panelTimeText = "";

  const leadingDateTime = remainder.match(
    /^(\d{1,2}-[A-Za-z]{3}-\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)?)\s+/i,
  );
  const leadingTime = remainder.match(/^(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)\s+/i);

  if (leadingDateTime) {
    panelTimeText = leadingDateTime[1].trim();
    remainder = remainder.slice(leadingDateTime[0].length).trim();
  } else if (leadingTime) {
    panelTimeText = leadingTime[1].trim();
    remainder = remainder.slice(leadingTime[0].length).trim();
  }

  // Extract status ONLY if it matches a known status token at the end
  let status = "";
  const words = remainder.split(/\s+/);
  if (words.length > 0) {
    const lastWord = words[words.length - 1].toUpperCase();
    if (KNOWN_STATUS_TOKENS.has(lastWord)) {
      status = lastWord;
      words.pop();
      remainder = words.join(" ").trim();
    }
  }

  if (!panelTimeText) {
    const trailingDateTime = remainder.match(
      /\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4}(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)?)\s*$/i,
    );
    const trailingTime = remainder.match(/\s+(\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?)\s*$/i);
    if (trailingDateTime) {
      panelTimeText = trailingDateTime[1].trim();
      remainder = remainder.slice(0, trailingDateTime.index).trim();
    } else if (trailingTime) {
      panelTimeText = trailingTime[1].trim();
      remainder = remainder.slice(0, trailingTime.index).trim();
    }
  }

  let deviceType = "";
  let location = remainder;
  const upperRemainder = remainder.toUpperCase();

  // Check CARD N (e.g. CARD 4, CARD 10, CARD-6)
  const cardMatch = upperRemainder.match(/\bCARD\s*[-]?\s*(\d+)\b/i);
  if (cardMatch) {
    deviceType = `CARD ${cardMatch[1]}`;
    location = remainder.replace(/\bCARD\s*[-]?\s*\d+\b/i, "").trim();
  } else {
    for (const type of PANEL_DEVICE_TYPES) {
      if (upperRemainder.endsWith(type)) {
        deviceType = type;
        location = remainder.slice(0, remainder.length - type.length).trim();
        break;
      }
    }
  }

  if (!deviceType && remainder) {
    if (/^P\d+$/i.test(deviceAddress)) {
      deviceType = "TROUBLE POINT";
      location = remainder;
    } else {
      const remWords = remainder.split(/\s+/);
      if (remWords.length >= 3) {
        deviceType = remWords.slice(-2).join(" ").toUpperCase();
        location = remWords.slice(0, -2).join(" ");
      } else if (remWords.length === 2) {
        deviceType = remWords[1].toUpperCase();
        location = remWords[0];
      } else {
        location = remainder;
        deviceType = "—";
      }
    }
  }

  if (!status) {
    status = "TRBL";
  }

  const parsedTime = extractPanelEventTime({
    raw: trimmed,
    panelTimeText,
  });

  return {
    fullAddress,
    deviceAddress,
    location: location || "—",
    deviceType: deviceType || "—",
    status,
    label: status.replace(/\*$/, ""),
    panelTimeText: panelTimeText || parsedTime.panelTimeText || "",
    time: parsedTime.timeMs,
    timestamp: parsedTime.timestampIso,
    // Exact panel line — compare against liveFire / liveTrouble / liveSupervisory history.
    raw: trimmed,
    rawMessage: trimmed,
  };
}

/** Format a timestamp for live panel list rows. */
export function formatPanelListTime(value) {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /[A-Za-z]/.test(value) && value.includes("-")) {
    const normalized = value.replace(/-(\d{2})\b/, "-20$1");
    const parsed = Date.parse(normalized);
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

/** Parse panel `list f|t|s` text into display rows with deduplication. */
export function parsePanelListResponse(text) {
  const map = new Map();
  for (const line of splitPanelListLines(text)) {
    const parsed = parsePanelListLine(line);
    if (parsed) {
      const key = parsed.fullAddress || parsed.deviceAddress || parsed.location;
      if (key) {
        map.set(key, parsed);
      }
    }
  }
  return Array.from(map.values());
}

/**
 * Split a list dump into raw message lines.
 * Simplex often uses CR and/or fixed-width NUL padding with no clean newlines.
 * We only insert breaks after a status token followed by a device address.
 */
export function splitPanelListLines(text) {
  const normalized = String(text || "")
    .replace(/\0/g, " ")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

  // Only break before an address if preceded by a known status token or delimiter.
  // Never break inside descriptions like "HRP-16" or "TECH AREA P16".
  const broken = normalized.replace(
    /(?<=\b(?:TRBL\*?|FIRE\*?|ALARM\*?|SUPV\*?|SUPERVISORY\*?|PRI2\*?|ACKED|NORMAL|OFF|ON|-)\b)\s+((?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+-\d+|\d+-\d+)\s+)/gi,
    "\n$1",
  );

  return broken
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => {
      if (!line) return false;
      if (line === "-") return false;
      if (/_DNE|_END\b/i.test(line)) return false;
      if (/^list\s+[fts]\b/i.test(line)) return false;
      if (/show\s+counts|FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+|PRIORITY2\s*=\s*\d+/i.test(line)) return false;
      return true;
    });
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
  // Category-wide acknowledge is a bare `ack` for Fire, Trouble and Supervisory.
  return `ack`;
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

export {
  syncPanelListWithTempArray,
  getTempPanelList,
  clearTempPanelList,
} from "./firePanelListHistory";

