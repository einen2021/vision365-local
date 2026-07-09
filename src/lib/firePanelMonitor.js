/** Shared constants and parsers for fire-panel CVAL monitoring. */

export const PANEL_STATE_REFRESH_MS = 5000;
export const MONITOR_INTERVAL_MS = 1000;
export const LIST_COMMAND_TIMEOUT_MS = 15000;

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
  return /_DNE/i.test(String(response));
}

/**
 * Parse CVAL from panel response. Accepts partial/garbled telnet output as long as
 * CVAL=<number> is present (strict full-line regex was failing on desktop).
 */
export function extractCVal(response, expectedCmd = "") {
  const text = String(response || "");
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
  const matches = String(response || "").match(regex) ?? [];
  return [...new Set(matches.map((value) => value.trim()))];
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
