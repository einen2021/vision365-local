import * as net from "net";
import { parentPort } from "worker_threads";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PanelLogKind =
  | "fire"
  | "trouble"
  | "supervisory"
  | "acknowledged"
  | "fire-acknowledged"
  | "reset-in-progress"
  | "reset-normal"
  | "reset-complete"
  | "reset-aborted"
  | "reset"
  | "cval"
  | "system"
  | "noise"
  | "other"
  | "unparsed";

interface PanelLogEntry {
  kind: PanelLogKind;
  raw: string;
  at: string;
  // Event record (fire / trouble / acknowledged / other)
  time?: string;
  weekday?: string;
  date?: string;
  location?: string;
  device?: string | null;
  status?: string;
  // List entry
  pointId?: string;
  description?: string;
  isListEntry?: boolean;
  // CVAL
  register?: "a0" | "a1" | "a2";
  cval?: number;
  systemType?: "error" | "login-success" | "banner";
}

type IncomingMessage =
  | { type: "connect"; id?: string; host: string; port: number }
  | { type: "disconnect" }
  | { type: "status"; id: string }
  | {
      type: "command";
      id: string;
      command: string;
      timeoutMs?: number;
      expectedCount?: number;
      priority?: boolean;
    };

type OutgoingMessage =
  | { type: "connected"; connected: boolean; host: string; port: number }
  | { type: "status"; id: string; connected: boolean; host: string; port: number }
  | { type: "panel-log"; entry: PanelLogEntry }
  | { type: "chunk"; id: string; response: string; done: boolean }
  | { type: "result"; id: string; ok: true; response: string }
  | { type: "result"; id: string; ok: false; error: string };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TCP_CONNECT_TIMEOUT_MS = 10_000;
const KEEPALIVE_INTERVAL_MS = 15_000;

// ---------------------------------------------------------------------------
// PanelDataParser
// ---------------------------------------------------------------------------

const DEVICE_TYPES = [
  "SUPERVISORY MONITOR",
  "SYSTEM POWER SUPPLY",
  "IDNET CARD",
  "SMOKE DETECTOR",
  "PULL STATION",
  "ALARM RELAY",
  "AUXILIARY RELAY",
  "TROUBLE POINT",
];

function splitLocationAndDevice(desc: string): {
  location: string;
  device: string | null;
} {
  let best: { idx: number; dt: string } | null = null;
  for (const dt of DEVICE_TYPES) {
    const idx = desc.lastIndexOf(dt);
    if (idx !== -1 && (best === null || idx > best.idx)) {
      best = { idx, dt };
    }
  }
  if (best) {
    return { location: desc.slice(0, best.idx).trim(), device: best.dt };
  }
  return { location: desc.trim(), device: null };
}

const RE_EVENT_HEADER =
  /^-?\s*(\d{1,2}:\d{2}:\d{2}\s*[ap]m)\s+([A-Z]{3})\s+(\d{2}-[A-Z]{3}-\d{2})\s+(.+?)\s*$/i;
const RE_EVENT_DETAIL = /^\s*(\S.*?)\s{2,}(\S.*?)\s*$/;
// Panel list dumps (list f/t/s) mark rows with a trailing "*" (e.g. "TRBL*", "SUPV*") —
// match every status token the panel can send, with or without the asterisk.
const RE_LIST_ENTRY = /^(\S+)\s+(.+?)\s+(TRBL|FIRE|SUPV|SUPR|SUPERVISORY|ALARM|PRI2)\*?\s*$/i;
const RE_ERROR = /^%ERROR\b/i;
const RE_LOGIN_OK = /^ACCESS GRANTED\s*$/i;
const RE_BANNER = /panel service port|reserved for authorized personnel/i;
const RE_CVAL_REGISTER = /^~A([012])/i;
const RE_CVAL_VALUE = /^CVAL\s*=\s*(\d+)/i;

const ID_PATTERN = "(?:\\d+:M\\d+-\\d+-\\d+|\\d+-\\d+-\\d+|P\\d+)";
const HEADER_PATTERN =
  "-?\\s*\\d{1,2}:\\d{2}:\\d{2}\\s*[ap]m\\s+[A-Z]{3}\\s+\\d{2}-[A-Z]{3}-\\d{2}";
const RE_GLUE_BOUNDARY = new RegExp(
  "(TRBL|FIRE)\\s*(?=" + ID_PATTERN + "\\s+[A-Z]|" + HEADER_PATTERN + ")",
  "i",
);

interface PendingHeader {
  time: string;
  weekday: string;
  date: string;
  location: string;
  raw: string;
}

class PanelDataParser {
  private _buffer = "";
  private _maxBufferLen: number;
  private _pendingHeader: PendingHeader | null = null;
  /** CVAL register (~A0/A1/A2) waiting for the CVAL=N line. */
  private _pendingCvalRegister: "0" | "1" | "2" | null = null;
  private _onEntry: (entry: PanelLogEntry) => void;

  constructor(
    onEntry: (entry: PanelLogEntry) => void,
    maxBufferLen = 1_000_000,
  ) {
    this._onEntry = onEntry;
    this._maxBufferLen = maxBufferLen;
  }

  feed(chunk: Buffer | string): void {
    this._buffer += chunk.toString("utf8");
    if (this._buffer.length > this._maxBufferLen) {
      this._buffer = this._buffer.slice(-this._maxBufferLen);
    }
    let idx: number;
    while ((idx = this._buffer.indexOf("\n")) !== -1) {
      const rawLine = this._buffer.slice(0, idx).replace(/\r$/, "");
      this._buffer = this._buffer.slice(idx + 1);
      this._processLine(rawLine);
    }
  }

  flush(): void {
    if (this._buffer.trim().length) {
      this._processLine(this._buffer);
    }
    this._buffer = "";
    this._flushPendingHeader();
  }

  private _processLine(rawLine: string): void {
    const line = this._sanitizeLine(rawLine);

    if (!line) {
      this._flushPendingHeader();
      return;
    }

    if (this._tryEventHeader(line)) return;
    if (this._pendingHeader && this._trySystemResetDetail(line)) return;
    if (this._pendingHeader && this._tryEventDetail(line)) return;
    if (this._tryStandaloneSystemReset(line, rawLine)) return;
    if (this._trySystemLine(line, rawLine)) return;
    if (this._tryStandaloneAlarmEvent(line, rawLine)) return;
    if (this._tryListEntry(line)) return;
    if (this._trySplitGluedLine(line)) return;

    this._flushPendingHeader();
    this._onEntry({ kind: "unparsed", raw: rawLine, at: new Date().toISOString() });
  }

  private _sanitizeLine(rawLine: string): string {
    const line = rawLine
      .replace(/\/\/[^/]*$/, "")
      .replace(/\r/g, "")
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .replace(/\s+$/, "");

    if (!line.trim()) return "";

    if (!/[A-Za-z0-9]/.test(line)) {
      this._onEntry({ kind: "noise", raw: rawLine, at: new Date().toISOString() });
      return "";
    }

    return line;
  }

  private _tryEventHeader(line: string): boolean {
    if (
      /\bshow\b|PRIMARY\s+STATUS|ENABLED\s+STATE|CUSTOM\s+LABEL|DEVICE\s+TYPE|POINT\s+TYPE|RAW\s+ANALOG|ALARM\s+THRESHOLD|CARD\s+TYPE/i.test(
        line,
      )
    ) {
      return false;
    }
    const m = RE_EVENT_HEADER.exec(line);
    if (!m) return false;
    if (RE_GLUE_BOUNDARY.test(line)) return false;

    this._flushPendingHeader();
    this._pendingHeader = {
      time: m[1].replace(/\s+/, " ").trim(),
      weekday: m[2],
      date: m[3],
      location: m[4].trim(),
      raw: line,
    };
    return true;
  }

  private _trySystemResetDetail(line: string): boolean {
    const trimmed = line.trim();
    let kind: PanelLogKind | null = null;
    let status = "";
    let description = "";

    if (/SYSTEM\s+RESET\s+IN\s+PROGRESS/i.test(trimmed)) {
      kind = "reset-in-progress";
      status = "SYSTEM RESET IN PROGRESS";
      description = "System Reset in Progress";
    } else if (/SYSTEM\s+IS\s+NORMAL/i.test(trimmed)) {
      kind = "reset-normal";
      status = "SYSTEM IS NORMAL";
      description = "System is Normal";
    } else if (/ALARM\s+PRESENT[,\s]+SYSTEM\s+RESET\s+ABORTED|SYSTEM\s+RESET\s+ABORTED/i.test(trimmed)) {
      kind = "reset-aborted";
      status = "ALARM PRESENT, SYSTEM RESET ABORTED";
      description = "Alarm Present, System Reset Aborted";
    } else if (/NO\s+ALARM\s+PRESENT[,\s]+SYSTEM\s+RESET\s+COMPLETE|SYSTEM\s+RESET\s+COMPLETE/i.test(trimmed)) {
      kind = "reset-complete";
      status = "NO ALARM PRESENT, SYSTEM RESET COMPLETE";
      description = "No Alarm Present, System Reset Complete";
    }

    if (!kind) return false;

    const record: PanelLogEntry = {
      kind,
      time: this._pendingHeader!.time,
      weekday: this._pendingHeader!.weekday,
      date: this._pendingHeader!.date,
      location: this._pendingHeader!.location,
      status,
      description,
      raw: `${this._pendingHeader!.raw} | ${line}`,
      at: new Date().toISOString(),
    };
    this._pendingHeader = null;
    this._onEntry(record);
    return true;
  }

  private _tryStandaloneSystemReset(line: string, rawLine: string): boolean {
    const trimmed = line.trim();
    let kind: PanelLogKind | null = null;
    let status = "";
    let description = "";

    if (/SYSTEM\s+RESET\s+IN\s+PROGRESS/i.test(trimmed)) {
      kind = "reset-in-progress";
      status = "SYSTEM RESET IN PROGRESS";
      description = "System Reset in Progress";
    } else if (/SYSTEM\s+IS\s+NORMAL/i.test(trimmed)) {
      kind = "reset-normal";
      status = "SYSTEM IS NORMAL";
      description = "System is Normal";
    } else if (/ALARM\s+PRESENT[,\s]+SYSTEM\s+RESET\s+ABORTED|SYSTEM\s+RESET\s+ABORTED/i.test(trimmed)) {
      kind = "reset-aborted";
      status = "ALARM PRESENT, SYSTEM RESET ABORTED";
      description = "Alarm Present, System Reset Aborted";
    } else if (/NO\s+ALARM\s+PRESENT[,\s]+SYSTEM\s+RESET\s+COMPLETE|SYSTEM\s+RESET\s+COMPLETE/i.test(trimmed)) {
      kind = "reset-complete";
      status = "NO ALARM PRESENT, SYSTEM RESET COMPLETE";
      description = "No Alarm Present, System Reset Complete";
    }

    if (!kind) return false;

    this._flushPendingHeader();
    this._onEntry({
      kind,
      status,
      description,
      raw: rawLine,
      at: new Date().toISOString(),
    });
    return true;
  }

  private _tryStandaloneAlarmEvent(line: string, rawLine: string): boolean {
    const trimmed = line.trim();
    // Do NOT treat show command outputs, status queries, or device property dumps as standalone alarms
    if (
      /\bshow\b|PRIMARY\s+STATUS|ENABLED\s+STATE|CUSTOM\s+LABEL|DEVICE\s+TYPE|POINT\s+TYPE|RAW\s+ANALOG|ALARM\s+THRESHOLD|CARD\s+TYPE/i.test(
        trimmed,
      )
    ) {
      return false;
    }
    if (/FIRE\s+ALARM\b/i.test(trimmed)) {
      this._flushPendingHeader();
      const { location, device } = splitLocationAndDevice(trimmed);
      const isAcked = /ACKED/i.test(trimmed);
      this._routeEvent({
        kind: isAcked ? "fire-acknowledged" : "fire",
        location,
        device: device || "FIRE DEVICE",
        status: isAcked ? "FIRE ALARM ACKED" : "FIRE ALARM",
        raw: rawLine,
        at: new Date().toISOString(),
      });
      return true;
    }
    return false;
  }

  private _tryEventDetail(line: string): boolean {
    const trimmed = line.trim();
    if (
      /\bshow\b|PRIMARY\s+STATUS|ENABLED\s+STATE|CUSTOM\s+LABEL|DEVICE\s+TYPE|POINT\s+TYPE|RAW\s+ANALOG|ALARM\s+THRESHOLD|CARD\s+TYPE/i.test(
        trimmed,
      )
    ) {
      this._pendingHeader = null;
      return false;
    }
    let device = "";
    let status = "";

    const m = RE_EVENT_DETAIL.exec(line);
    if (m) {
      device = m[1].trim();
      status = m[2].trim();
    } else {
      const matchStatus = trimmed.match(
        /(FIRE\s+ALARM(?:\s+ACKED)?|FIRE(?:\s+ACKED)?|NORMAL\s+ACKED|TROUBLE(?:\s+ACKED)?|TRBL(?:\s+ACKED)?|SUPERVISORY(?:\s+ACKED)?|SUPV(?:\s+ACKED)?|ACKED)$/i,
      );
      if (matchStatus) {
        status = matchStatus[1].trim();
        device = trimmed.slice(0, matchStatus.index).trim();
      } else {
        return false;
      }
    }

    const record: Omit<PanelLogEntry, "kind"> = {
      time: this._pendingHeader!.time,
      weekday: this._pendingHeader!.weekday,
      date: this._pendingHeader!.date,
      location: this._pendingHeader!.location,
      device: device || "FIRE DEVICE",
      status,
      raw: `${this._pendingHeader!.raw} | ${line}`,
      at: new Date().toISOString(),
    };
    this._pendingHeader = null;
    this._routeEvent(record as PanelLogEntry);
    return true;
  }

  private _routeEvent(record: PanelLogEntry): void {
    let kind: PanelLogKind;
    const status = record.status || "";
    const device = record.device || "";

    if (/SYSTEM\s+RESET\s+IN\s+PROGRESS/i.test(status)) {
      kind = "reset-in-progress";
    } else if (/SYSTEM\s+IS\s+NORMAL/i.test(status)) {
      kind = "reset-normal";
    } else if (/SYSTEM\s+RESET\s+ABORTED/i.test(status)) {
      kind = "reset-aborted";
    } else if (/SYSTEM\s+RESET\s+COMPLETE/i.test(status)) {
      kind = "reset-complete";
    } else if (!/ACKED/i.test(status) && /\bNORMAL\b|CLEAR|RESTOR/i.test(status)) {
      // Device restored / trouble cleared — never a new alarm, even when the
      // status mentions TROUBLE or the device is a SUPERVISORY MONITOR.
      kind = "other";
    } else if (/^FIRE ALARM\b.*ACKED/i.test(status)) {
      kind = "fire-acknowledged";
    } else if (/^FIRE ALARM$/i.test(status)) {
      kind = "fire";
    } else if (/^NORMAL ACKED$/i.test(status)) {
      kind = "acknowledged";
    } else if (/SUPERVISORY|SUPV|SUPR/i.test(status) || /SUPERVISORY/i.test(device)) {
      if (/ACKED/i.test(status)) {
        kind = "acknowledged";
      } else {
        kind = "supervisory";
      }
    } else if (/TROUBLE|TRBL|DIRTY|NO ANSWER/i.test(status)) {
      if (/ACKED/i.test(status)) {
        kind = "acknowledged";
      } else {
        kind = "trouble";
      }
    } else if (/ACKED/i.test(status)) {
      kind = "acknowledged";
    } else {
      kind = "other";
    }
    this._onEntry({ ...record, kind });
  }

  private _tryListEntry(line: string): boolean {
    const m = RE_LIST_ENTRY.exec(line);
    if (!m) return false;
    if (RE_GLUE_BOUNDARY.test(line)) return false;

    const pointId = m[1];
    const desc = m[2].trim();
    const status = m[3];
    const { location, device } = splitLocationAndDevice(desc);

    const upperStatus = status.toUpperCase();
    const kind: PanelLogKind = /^(FIRE|ALARM)/.test(upperStatus)
      ? "fire"
      : /SUPV|SUPR|SUPERVISORY/.test(upperStatus)
        ? "supervisory"
        : "trouble";

    this._onEntry({
      kind,
      raw: line,
      at: new Date().toISOString(),
      pointId,
      location,
      device,
      description: desc,
      status,
      isListEntry: true,
    });
    return true;
  }

  private _trySystemLine(line: string, rawLine: string): boolean {
    // CVAL register line: ~A0, ~A1, ~A2
    const regMatch = RE_CVAL_REGISTER.exec(line);
    if (regMatch) {
      this._pendingCvalRegister = regMatch[1] as "0" | "1" | "2";
      return true; // swallow silently — CVAL=N line follows
    }

    // CVAL value line: CVAL=261
    const cvalMatch = RE_CVAL_VALUE.exec(line);
    if (cvalMatch) {
      const registerMap: Record<string, "a0" | "a1" | "a2"> = {
        "0": "a0",
        "1": "a1",
        "2": "a2",
      };
      const register = this._pendingCvalRegister !== null
        ? registerMap[this._pendingCvalRegister]
        : undefined;
      this._pendingCvalRegister = null;
      this._onEntry({
        kind: "cval",
        raw: line,
        at: new Date().toISOString(),
        register,
        cval: Number(cvalMatch[1]),
      });
      return true;
    }

    // Show command outputs: show <address>, show counts, PRIMARY STATUS, ENABLED STATE, DEVICE TYPE, POINT TYPE, CUSTOM LABEL, RAW ANALOG, etc.
    if (
      /\bshow\b|PRIMARY\s+STATUS|ENABLED\s+STATE|CUSTOM\s+LABEL|DEVICE\s+TYPE|POINT\s+TYPE|RAW\s+ANALOG|ALARM\s+THRESHOLD|CARD\s+TYPE/i.test(
        line,
      ) ||
      /show\s+counts|FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+/i.test(line)
    ) {
      this._pendingHeader = null;
      this._onEntry({ kind: "system", systemType: "banner", raw: rawLine, at: new Date().toISOString() });
      return true;
    }

    if (RE_ERROR.test(line)) {
      this._onEntry({ kind: "system", systemType: "error", raw: rawLine, at: new Date().toISOString() });
      return true;
    }
    if (RE_LOGIN_OK.test(line)) {
      this._onEntry({ kind: "system", systemType: "login-success", raw: rawLine, at: new Date().toISOString() });
      return true;
    }
    if (RE_BANNER.test(line)) {
      this._onEntry({ kind: "system", systemType: "banner", raw: rawLine, at: new Date().toISOString() });
      return true;
    }
    if (/^!.*!$/.test(line.trim()) || /^-+$/.test(line.trim())) {
      this._onEntry({ kind: "system", systemType: "banner", raw: rawLine, at: new Date().toISOString() });
      return true;
    }

    return false;
  }

  private _trySplitGluedLine(line: string): boolean {
    // 1. Split if another event header is embedded mid-line (e.g. SYSTEM IS NORMAL -  3:58:16 am...)
    const headerMatch = /(?<=\S)\s{2,}(?=-?\s*\d{1,2}:\d{2}:\d{2}\s*[ap]m\s+[A-Z]{3}\s+\d{2}-[A-Z]{3}-\d{2})/i.exec(line);
    if (headerMatch) {
      const splitIdx = headerMatch.index;
      const first = line.slice(0, splitIdx);
      const second = line.slice(splitIdx);
      if (first.trim() && second.trim()) {
        this._processLine(first);
        this._processLine(second);
        return true;
      }
    }

    const m = RE_GLUE_BOUNDARY.exec(line);
    if (!m) return false;
    const splitIdx = m.index + m[1].length;
    const first = line.slice(0, splitIdx);
    const second = line.slice(splitIdx);
    if (!first.trim() || !second.trim()) return false;
    this._processLine(first);
    this._processLine(second);
    return true;
  }

  private _flushPendingHeader(): void {
    if (this._pendingHeader) {
      this._onEntry({
        kind: "unparsed",
        raw: this._pendingHeader.raw,
        at: new Date().toISOString(),
      });
      this._pendingHeader = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Socket state
// ---------------------------------------------------------------------------

let socket: net.Socket | null = null;
let currentHost = "";
let currentPort = 23;
let connectInFlight: Promise<void> | null = null;
let parser: PanelDataParser | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function post(msg: OutgoingMessage) {
  parentPort?.postMessage(msg);
}

function isSocketLive(sock: net.Socket | null): sock is net.Socket {
  return Boolean(sock && !sock.destroyed && sock.writable);
}

function createParser(): PanelDataParser {
  return new PanelDataParser((entry) => {
    // Drop pure noise from the SSE/DB stream — too high volume
    if (entry.kind === "noise") return;
    // ACCESS GRANTED starts the login session even when it arrives late,
    // after the login command already returned with other output.
    if (entry.kind === "system" && entry.systemType === "login-success" && socket) {
      loginSession = { socket, at: Date.now() };
    }
    post({ type: "panel-log", entry });
  });
}

// ---------------------------------------------------------------------------
// Connect / disconnect
// ---------------------------------------------------------------------------

async function connect(host: string, port: number) {
  if (isSocketLive(socket) && currentHost === host && currentPort === port) {
    post({ type: "connected", connected: true, host, port });
    return;
  }

  if (connectInFlight) {
    await connectInFlight;
    if (!isSocketLive(socket)) throw new Error("Failed to connect to fire panel");
    return;
  }

  connectInFlight = (async () => {
    if (socket) {
      const prev = socket;
      socket = null;
      parser?.flush();
      parser = null;
      prev.removeAllListeners();
      prev.destroy();
    }

    await new Promise<void>((resolve, reject) => {
      const sock = new net.Socket();

      const cleanup = () => {
        sock.removeListener("connect", onConnect);
        sock.removeListener("error", onError);
        sock.removeListener("timeout", onTimeout);
        sock.destroy();
      };
      const onError = (err: Error) => { cleanup(); reject(err); };
      const onTimeout = () => {
        cleanup();
        reject(new Error(`TCP connect timed out after ${TCP_CONNECT_TIMEOUT_MS}ms`));
      };
      const onConnect = () => {
        sock.removeListener("error", onError);
        sock.removeListener("timeout", onTimeout);
        sock.setTimeout(0);
        sock.setKeepAlive(true, KEEPALIVE_INTERVAL_MS);
        sock.setNoDelay(true);

        socket = sock;
        currentHost = host;
        currentPort = port;
        parser = createParser();
        staleOutputPending = false;

        attachSocketHandlers(sock);
        resolve();
      };

      sock.setTimeout(TCP_CONNECT_TIMEOUT_MS);
      sock.once("connect", onConnect);
      sock.once("error", onError);
      sock.once("timeout", onTimeout);
      sock.connect(port, host);
    });

    post({ type: "connected", connected: true, host: currentHost, port: currentPort });
  })();

  try {
    await connectInFlight;
  } finally {
    connectInFlight = null;
  }
}

// ---------------------------------------------------------------------------
// Active Command Response Collection
// ---------------------------------------------------------------------------

type CommandMessage = Extract<IncomingMessage, { type: "command" }>;

/**
 * Operational rank (lower = more urgent) — see COMMAND_PRIORITY.md.
 *   2  ack / silence / login / set / disable / enable (life-safety controls)
 *   3  list f
 *   4  list t / list s / show counts
 *   5  show <addr>
 *   6  anything else (terminal console, cshow cval)
 *   7  cshow * (bulk export)
 */
function rankFor(command: string): number {
  const c = command.trim().toLowerCase();
  if (/^(ack|silence|login|set|disable|enable)\b/.test(c)) return 2;
  if (/^list\s+f\b/.test(c)) return 3;
  if (/^list\s+[ts]\b/.test(c) || /^show\s+counts\b/.test(c)) return 4;
  if (/^show\b/.test(c)) return 5;
  if (/^cshow\s+\*/.test(c)) return 7;
  return 6;
}

/** Long multi-row dumps that can be cancelled and restarted for a more urgent command. */
function isPreemptibleDump(command: string): boolean {
  return /^(list|cshow)\b/i.test(command.trim());
}

/**
 * Commands with no reply of their own (ack / set). They complete as soon as the
 * panel echoes the line (or after ECHO_ONLY_MAX_MS), so the next command is
 * never typed into the middle of one the panel is still reading — typing them
 * back-to-back garbled lines on the panel ("sset 2:p212 on" → %ERROR).
 */
function isEchoOnly(command: string): boolean {
  return /^(ack|set)\b/i.test(command);
}

/** Longest wait for an ack / set echo before moving on regardless. */
const ECHO_ONLY_MAX_MS = 600;

/**
 * After a control command (ack / login / set) list dumps are held back this
 * long, so a dump cannot restart in the short gap between e.g. ack → silence →
 * reset and have the next control command typed into its output.
 */
const CONTROL_QUIET_MS = 3000;
/**
 * `list t` / `list s` wait longer after a control command: the panel ignores
 * typed commands until a dump ends, so a 200-row trouble list started between
 * a disable and the following enable held the enable back ~40s.
 */
const LIST_TS_CONTROL_QUIET_MS = 15000;
let lastControlAt = 0;

function controlQuietMsFor(command: string): number {
  return /^list\s+[ts]\b/i.test(command.trim()) ? LIST_TS_CONTROL_QUIET_MS : CONTROL_QUIET_MS;
}

// ---------------------------------------------------------------------------
// Login session
// ---------------------------------------------------------------------------

/** One panel login is reused this long for every command that needs it. */
const LOGIN_SESSION_MS = 3 * 60 * 1000;
let loginSession: { socket: net.Socket; at: number } | null = null;

function isLoginCommand(command: string): boolean {
  return /^login\b/i.test(command.trim());
}

function loginSessionActive(): boolean {
  return Boolean(
    loginSession &&
      socket &&
      loginSession.socket === socket &&
      isSocketLive(socket) &&
      Date.now() - loginSession.at < LOGIN_SESSION_MS,
  );
}

/**
 * Remember a login the panel accepted. Only ACCESS GRANTED / ALREADY count —
 * after a freeze the reply can be another command's late output.
 */
function recordLoginResult(response: string) {
  const text = String(response || "").replace(/\r/g, "");
  if (/ACCESS\s+GRANTED|ALREADY/i.test(text) && socket) {
    loginSession = { socket, at: Date.now() };
  } else if (/ACCESS\s+DENIED/i.test(text)) {
    loginSession = null;
  }
}
let deferredProcessTimer: NodeJS.Timeout | null = null;

function isControlCommand(command: string): boolean {
  return rankFor(command) <= 2;
}

interface PendingCommand {
  id: string;
  command: string;
  msg: CommandMessage;
  rank: number;
  buffer: string;
  /**
   * Set when a dump was just cancelled: the panel may still be sending its tail.
   * Incoming text is held in `preBuffer` until this command's echo shows up (or
   * the line goes quiet) so stale rows do not leak into this response.
   */
  awaitingEcho: boolean;
  preBuffer: string;
  quietTimer: NodeJS.Timeout | null;
  /** Trailing timer for throttled partial `chunk` posts (list dumps). */
  chunkTimer: NodeJS.Timeout | null;
  lastChunkAt: number;
  expectedCount?: number;
  /** Original per-gap budget — reused to extend timeoutTimer while a list dump is still progressing. */
  timeoutMs: number;
  timeoutTimer: NodeJS.Timeout;
  silenceTimer: NodeJS.Timeout | null;
  priority?: boolean;
  /** Highest list-row address count seen so far, for progress-based deadline extension. */
  lastProgressCount?: number;
  /** ack / set — done once the panel echoes the line. */
  echoOnly?: boolean;
}

let activeCommand: PendingCommand | null = null;
const commandQueue: Array<{ msg: CommandMessage; rank: number }> = [];
/** True after a dump was cancelled mid-stream until the next collecting command syncs on its echo. */
let staleOutputPending = false;

function clearCommandTimers(cmd: PendingCommand) {
  if (cmd.timeoutTimer) clearTimeout(cmd.timeoutTimer);
  if (cmd.silenceTimer) clearTimeout(cmd.silenceTimer);
  if (cmd.quietTimer) clearTimeout(cmd.quietTimer);
  if (cmd.chunkTimer) clearTimeout(cmd.chunkTimer);
}

const CHUNK_POST_INTERVAL_MS = 100;

/**
 * Stream the growing dump to callers at most every CHUNK_POST_INTERVAL_MS — each
 * post carries the whole cumulative buffer, so one per telnet packet is wasted
 * work all the way to the browser. The final `done` chunk is always sent.
 */
function postPartialChunk(cmd: PendingCommand) {
  const wait = cmd.lastChunkAt + CHUNK_POST_INTERVAL_MS - Date.now();
  if (wait <= 0) {
    if (cmd.chunkTimer) clearTimeout(cmd.chunkTimer);
    cmd.chunkTimer = null;
    cmd.lastChunkAt = Date.now();
    post({ type: "chunk", id: cmd.id, response: cmd.buffer, done: false });
    return;
  }
  if (!cmd.chunkTimer) {
    cmd.chunkTimer = setTimeout(() => {
      cmd.chunkTimer = null;
      if (activeCommand === cmd) postPartialChunk(cmd);
    }, wait);
  }
}

/** Queue by rank; FIFO within a rank. `front` puts it ahead of its own rank (restarted dumps). */
function enqueueCommand(msg: CommandMessage, front = false) {
  const rank = rankFor(msg.command);
  if (front) {
    commandQueue.unshift({ msg, rank });
  } else {
    commandQueue.push({ msg, rank });
  }
}

function completeActiveCommand() {
  if (!activeCommand) return;
  const cmd = activeCommand;
  activeCommand = null;
  if (isControlCommand(cmd.command)) lastControlAt = Date.now();

  clearCommandTimers(cmd);
  if (isLoginCommand(cmd.command)) recordLoginResult(cmd.buffer);

  // Final partial chunk so streaming callers see the completed dump (list commands only).
  if (cmd.command.toLowerCase().startsWith("list")) {
    post({ type: "chunk", id: cmd.id, response: cmd.buffer, done: true });
  }

  post({
    type: "result",
    id: cmd.id,
    ok: true,
    response: cmd.buffer,
  });

  // A dump completed by row count can finish before the panel prints its last
  // characters and "-" prompt. That tail would land in the next command's
  // response, so make the next collecting command wait for its own echo.
  if (isPreemptibleDump(cmd.command) && !dumpEndedWithPrompt(cmd.buffer)) {
    staleOutputPending = true;
  }

  processNextCommand();
}

function dumpEndedWithPrompt(buffer: string): boolean {
  const text = buffer.replace(/\r/g, "").replace(/\s+$/, "");
  return /_DNE|_END/i.test(text) || /(?:^|\n)\s*-$/.test(text);
}

function processNextCommand() {
  if (activeCommand) return;
  if (commandQueue.length === 0) return;

  // Hold list dumps for a while after a control command (CONTROL_QUIET_MS,
  // LIST_TS_CONTROL_QUIET_MS); other queued commands still run meanwhile.
  const now = Date.now();
  let best = -1;
  let soonestWait = Infinity;
  for (let i = 0; i < commandQueue.length; i++) {
    const { msg, rank } = commandQueue[i];
    if (isPreemptibleDump(msg.command)) {
      const wait = lastControlAt + controlQuietMsFor(msg.command) - now;
      if (wait > 0) {
        soonestWait = Math.min(soonestWait, wait);
        continue;
      }
    }
    if (best === -1 || rank < commandQueue[best].rank) best = i;
  }

  if (best === -1) {
    if (deferredProcessTimer) clearTimeout(deferredProcessTimer);
    deferredProcessTimer = setTimeout(() => {
      deferredProcessTimer = null;
      processNextCommand();
    }, soonestWait);
    return;
  }

  executeCommand(commandQueue.splice(best, 1)[0].msg);
}

/**
 * A dump stopped for a more urgent command. Panels differ in what happens next:
 *   - the dump aborts and the urgent command is echoed right away → restart the
 *     dump once the urgent commands are done;
 *   - the panel finishes the dump first and only then runs the urgent command →
 *     the rows are still arriving, so complete the original dump from them
 *     (restarting would make the panel dump twice and delay later commands).
 * Whichever shows up first in the stream — the urgent command's echo, or the
 * end of the dump — decides.
 */
interface SuspendedDump {
  cmd: PendingCommand;
  /** Command whose echo means "the panel aborted the dump". */
  echoOf: string;
  /** Panel text received since the dump was suspended. */
  tail: string;
  timer: NodeJS.Timeout | null;
}

let suspendedDump: SuspendedDump | null = null;

/** Restart a suspended dump when the line goes this quiet without either signal. */
const SUSPENDED_DUMP_IDLE_MS = 2000;

const RE_LIST_ROW = /(?:^|\n)\s*(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+(?:-\d+)?)\b/g;
const RE_PROMPT_LINE = /(?:^|\n)\s*-\s*(?:\n|$)/;

function countListRows(text: string): number {
  return (text.match(RE_LIST_ROW) || []).length;
}

/** Start offset of the panel's echo line for `command` in `text`, or -1. */
function findEchoLine(text: string, command: string): number {
  const want = command.trim().toLowerCase().replace(/\s+/g, " ");
  let start = 0;
  for (;;) {
    const nl = text.indexOf("\n", start);
    const end = nl === -1 ? text.length : nl;
    const line = text
      .slice(start, end)
      .replace(/[\r\x00]/g, "")
      .replace(/^[\s-]+/, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");
    // The echo may be glued to a previous dump's tail ("TRBL show counts").
    if (line === want || line.endsWith(" " + want)) return start;
    if (nl === -1) return -1;
    start = nl + 1;
  }
}

/** True when `tail` finishes the suspended dump (prompt / _DNE with the expected row count). */
function isSuspendedDumpComplete(cmd: PendingCommand, tail: string): boolean {
  const cleanTail = tail.replace(/\r/g, "");
  const ended = /_DNE|_END/i.test(cleanTail) || RE_PROMPT_LINE.test(cleanTail);
  const count = countListRows((cmd.buffer + tail).replace(/\r/g, ""));
  const exp = cmd.msg.expectedCount || 0;
  if (exp > 0) return count >= exp || (ended && count >= Math.floor(exp * 0.95));
  return ended && count > 0;
}

function armSuspendedDumpTimer(s: SuspendedDump) {
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(restartSuspendedDump, SUSPENDED_DUMP_IDLE_MS);
}

function takeSuspendedDump(): SuspendedDump | null {
  const s = suspendedDump;
  if (!s) return null;
  if (s.timer) clearTimeout(s.timer);
  suspendedDump = null;
  return s;
}

function restartSuspendedDump() {
  const s = takeSuspendedDump();
  if (!s) return;
  enqueueCommand(s.cmd.msg, true);
  processNextCommand();
}

function failSuspendedDump(error: string) {
  const s = takeSuspendedDump();
  if (!s) return;
  post({ type: "result", id: s.cmd.id, ok: false, error });
}

/** Route panel text to the suspended dump and settle it once the stream shows which way the panel went. */
function feedSuspendedDump(text: string) {
  const s = suspendedDump;
  if (!s) return;
  s.tail += text;

  const echoAt = findEchoLine(s.tail, s.echoOf);
  const beforeEcho = echoAt === -1 ? s.tail : s.tail.slice(0, echoAt);
  if (isSuspendedDumpComplete(s.cmd, beforeEcho)) {
    takeSuspendedDump();
    const response = s.cmd.buffer + beforeEcho;
    post({ type: "chunk", id: s.cmd.id, response, done: true });
    post({ type: "result", id: s.cmd.id, ok: true, response });
    return;
  }
  if (echoAt !== -1) {
    restartSuspendedDump();
    return;
  }
  // Rows still streaming — the panel queued the urgent command behind the dump.
  armSuspendedDumpTimer(s);
}

/**
 * Ack/silence/reset must reach the panel immediately — waiting behind a slow
 * in-flight dump (hundreds of "list" rows) would delay a life-safety action by
 * many seconds. Stop collecting the active dump so the urgent command is written
 * now; the dump is then either completed from the rows still arriving or
 * restarted (see SuspendedDump). Its caller still receives one complete response.
 */
function preemptActiveDump(incomingCommand: string) {
  if (!activeCommand) return;
  const cmd = activeCommand;
  activeCommand = null;
  clearCommandTimers(cmd);
  staleOutputPending = true;

  if (suspendedDump) {
    // Already watching an earlier dump — just restart this one later.
    enqueueCommand(cmd.msg, true);
    return;
  }
  suspendedDump = { cmd, echoOf: incomingCommand, tail: "", timer: null };
  armSuspendedDumpTimer(suspendedDump);
}

function executeCommand(msg: CommandMessage) {
  if (!isSocketLive(socket)) {
    post({
      type: "result",
      id: msg.id,
      ok: false,
      error: "Fire panel not connected",
    });
    processNextCommand();
    return;
  }

  const clean = msg.command.replace(/[\r\n]+/g, " ").trim();
  if (!clean) {
    post({ type: "result", id: msg.id, ok: true, response: "OK" });
    processNextCommand();
    return;
  }

  if (isControlCommand(clean)) lastControlAt = Date.now();

  // ack / set have no reply — wait only for the panel's echo (ECHO_ONLY_MAX_MS
  // at most). Other commands (login, show, disable, enable, list) collect output.
  const echoOnly = isEchoOnly(clean);
  const timeoutMs = echoOnly
    ? ECHO_ONLY_MAX_MS
    : msg.timeoutMs && msg.timeoutMs > 0
      ? msg.timeoutMs
      : 5000;

  const awaitingEcho = staleOutputPending;
  staleOutputPending = false;

  activeCommand = {
    id: msg.id,
    command: clean,
    msg,
    rank: rankFor(clean),
    buffer: "",
    awaitingEcho,
    preBuffer: "",
    quietTimer: null,
    chunkTimer: null,
    lastChunkAt: 0,
    expectedCount: msg.expectedCount,
    timeoutMs,
    timeoutTimer: setTimeout(() => {
      if (activeCommand && activeCommand.id === msg.id) {
        completeActiveCommand();
      }
    }, timeoutMs),
    silenceTimer: null,
    priority: msg.priority,
    lastProgressCount: 0,
    echoOnly,
  };

  socket.write(`${clean}\r\n`, (err) => {
    if (err && activeCommand && activeCommand.id === msg.id) {
      clearCommandTimers(activeCommand);
      const cmdId = activeCommand.id;
      activeCommand = null;
      post({
        type: "result",
        id: cmdId,
        ok: false,
        error: err.message || "Failed to write command to socket",
      });
      processNextCommand();
    }
  });
}

function attachSocketHandlers(sock: net.Socket) {
  sock.on("close", () => {
    if (socket !== sock) return;
    parser?.flush();
    parser = null;
    socket = null;
    if (activeCommand) {
      clearCommandTimers(activeCommand);
      post({
        type: "result",
        id: activeCommand.id,
        ok: false,
        error: "Socket closed while waiting for response",
      });
      activeCommand = null;
    }
    failSuspendedDump("Socket closed");
    while (commandQueue.length > 0) {
      const item = commandQueue.shift();
      if (item) {
        post({
          type: "result",
          id: item.msg.id,
          ok: false,
          error: "Socket closed",
        });
      }
    }
    post({ type: "connected", connected: false, host: currentHost, port: currentPort });
  });

  sock.on("error", (err: NodeJS.ErrnoException) => {
    if (socket !== sock) return;
    const msg = err?.message || "";
    if (/ECONNRESET|EPIPE|ETIMEDOUT/i.test(msg)) {
      parser?.flush();
      parser = null;
      socket = null;
      post({ type: "connected", connected: false, host: currentHost, port: currentPort });
    }
  });

  // Feed all incoming panel data into the parser & collect command responses
  sock.on("data", (chunk: Buffer) => {
    // 1. If an interactive query command is active (show <address>, cshow, login, disable, enable),
    // do not feed its response chunks to the spontaneous alarm parser.
    const isInteractiveQuery =
      activeCommand &&
      (activeCommand.command.toLowerCase().startsWith("show") ||
        activeCommand.command.toLowerCase().startsWith("cshow") ||
        activeCommand.command.toLowerCase().startsWith("login") ||
        activeCommand.command.toLowerCase().startsWith("disable") ||
        activeCommand.command.toLowerCase().startsWith("enable"));

    if (!isInteractiveQuery) {
      parser?.feed(chunk);
    }

    const text = chunk.toString("utf8");
    feedSuspendedDump(text);

    // 2. If an active command is waiting for response, collect the chunk
    if (activeCommand && appendToActiveCommand(activeCommand, text)) {
      evaluateActiveCommand();
    }
  });
}

const ECHO_QUIET_MS = 300;

/**
 * Add panel text to the active command's response. While `awaitingEcho` (a dump
 * was just cancelled), text is held back until this command's echo appears, or
 * until the line has been quiet for ECHO_QUIET_MS (then everything held is kept).
 * Returns false while still waiting for the echo.
 */
function appendToActiveCommand(cmd: PendingCommand, text: string): boolean {
  if (!cmd.awaitingEcho) {
    cmd.buffer += text;
    return true;
  }

  cmd.preBuffer += text;
  const echoIdx = findEchoLine(cmd.preBuffer, cmd.command);
  if (echoIdx !== -1) {
    releaseEchoGate(cmd, cmd.preBuffer.slice(echoIdx));
    return true;
  }

  if (cmd.quietTimer) clearTimeout(cmd.quietTimer);
  cmd.quietTimer = setTimeout(() => {
    if (activeCommand !== cmd || !cmd.awaitingEcho) return;
    releaseEchoGate(cmd, cmd.preBuffer);
    evaluateActiveCommand();
  }, ECHO_QUIET_MS);
  return false;
}

function releaseEchoGate(cmd: PendingCommand, buffer: string) {
  if (cmd.quietTimer) clearTimeout(cmd.quietTimer);
  cmd.quietTimer = null;
  cmd.awaitingEcho = false;
  cmd.preBuffer = "";
  cmd.buffer = buffer;
}

/** `show counts` reply holds all three totals (FIRE / SUPERVISORY / TROUBLE). */
function hasAllCounts(text: string): boolean {
  return (
    /FIRE\s*=\s*\d+/i.test(text) &&
    /SUPERVISORY\s*=\s*\d+/i.test(text) &&
    // TROUBLE is last on the line: only complete once the line ends. Its
    // digits can arrive in separate chunks ("TROUBLE = 2" then "17") — reading
    // the first part as 2 started a bogus list t that swallowed the next ack.
    /TROUBLE\s*=\s*\d+[ \t]*[\r\n]/i.test(text)
  );
}

/** Complete the active command when its response is recognisably done; otherwise (re)arm the silence timer. */
function evaluateActiveCommand() {
  if (activeCommand) {
    const trimmed = activeCommand.buffer.trim();
    const lowerCmd = activeCommand.command.toLowerCase();

    let isComplete = false;

    if (activeCommand.echoOnly) {
      // Done once the panel echoes the line; otherwise ECHO_ONLY_MAX_MS ends it.
      if (findEchoLine(activeCommand.buffer, activeCommand.command) !== -1 || /%ERROR/i.test(trimmed)) {
        completeActiveCommand();
      }
      return;
    } else if (lowerCmd.startsWith("login")) {
      if (/ACCESS GRANTED|ACCESS DENIED|%ERROR|INVALID|ALREADY|LEVEL/i.test(trimmed) || trimmed.endsWith("-") || /\n-\s*$/.test(trimmed)) {
        isComplete = true;
      }
    } else if (lowerCmd.startsWith("show counts")) {
      // Wait for the whole counts line. A "-" prompt can be left over from a
      // previous dump, so a prompt alone must not finish a half-received
      // "FIRE = 0  PRIORITY2 =" (read downstream as TROUBLE = 0).
      if (hasAllCounts(trimmed) || /%ERROR|INVALID/i.test(trimmed)) {
        isComplete = true;
      }
    } else if (lowerCmd.startsWith("show")) {
      const hasError = /%ERROR|INVALID|NOT FOUND|ACCESS DENIED/i.test(trimmed);
      const hasPrimaryStatus = /PRIMARY STATUS\s*(?::|\s)\s*(NORM|FIRE|DIRT|DISA|DISABLE|ABNOR|NO\s*ANS|SUP|OPEN|SHORT|TEST|OFF|ON|ACTIVE|INACT|UNVER)/i.test(trimmed);
      const hasPromptAtEnd = trimmed.endsWith("-") || /-\s*$/.test(trimmed) || /_DNE|_END/i.test(trimmed);
      const hasEnabledState = /ENABLED STATE\s*(?::|\s)\s*(ENABLED|DISABLED)/i.test(trimmed);

      if (hasError || (hasPrimaryStatus && (hasPromptAtEnd || hasEnabledState))) {
        isComplete = true;
      }
    } else if (lowerCmd.startsWith("disable") || lowerCmd.startsWith("enable")) {
      if (/COMMAND ACCEPTED|%ERROR|INVALID|DISABLED|ENABLED/i.test(trimmed) || trimmed.endsWith("-") || /\n-\s*$/.test(trimmed)) {
        isComplete = true;
      }
    } else if (lowerCmd.startsWith("list")) {
      const exp = activeCommand.expectedCount || 0;
      const addressMatches = trimmed.match(/(?:^|\n)\s*(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+(?:-\d+)?)\b/g);
      const count = addressMatches ? addressMatches.length : 0;

      // Stream the growing dump on every chunk so callers can save rows one by
      // one as they arrive, instead of waiting for the full expected count.
      postPartialChunk(activeCommand);

      // Slow panels can take minutes to dump hundreds of rows one at a time. As
      // long as new rows keep trickling in, push the deadline back instead of
      // cutting the dump off mid-stream (a retry restarts "list" from row 1, so
      // a fixed total-time budget would otherwise mean the tail rows are never
      // reached no matter how many attempts run).
      if (exp > 0 && count > (activeCommand.lastProgressCount || 0)) {
        activeCommand.lastProgressCount = count;
        const cmdId = activeCommand.id;
        clearTimeout(activeCommand.timeoutTimer);
        activeCommand.timeoutTimer = setTimeout(() => {
          if (activeCommand && activeCommand.id === cmdId) {
            completeActiveCommand();
          }
        }, activeCommand.timeoutMs);
      }

      if (exp > 0) {
        // If expectedCount is set (e.g. 215), only complete when count >= exp OR _DNE/_END reached with count >= 95%
        if (count >= exp || (count >= Math.floor(exp * 0.95) && /_DNE|_END/i.test(trimmed))) {
          isComplete = true;
        }
      } else {
        // No expectedCount specified: complete if ends with prompt "-" after receiving at least 1 line or _DNE/_END
        if (
          /_DNE|_END/i.test(trimmed) ||
          /%ERROR|INVALID/i.test(trimmed) ||
          (count > 0 && (trimmed.endsWith("-") || /\n-\s*$/.test(trimmed)))
        ) {
          isComplete = true;
        }
      }
    }

    if (isComplete) {
      completeActiveCommand();
      return;
    }

    // Reset silence timer: finalize response after data chunk arrives
    if (activeCommand.silenceTimer) {
      clearTimeout(activeCommand.silenceTimer);
    }
    activeCommand.silenceTimer = setTimeout(() => {
      if (!activeCommand) return;
      const bufTrimmed = activeCommand.buffer.trim();
      const cmdClean = activeCommand.command.trim();

      // If buffer only contains the echoed command (or command prompt with no actual response text yet),
      // do not complete early on silence — keep waiting for the panel data until timeoutTimer.
      const stripped = bufTrimmed
        .replace(/^-+\s*/, "")
        .replace(/\s*-+$/, "")
        .replace(/[\r\n\-]+/g, " ")
        .trim();
      const isOnlyEcho =
        stripped === cmdClean ||
        stripped === "" ||
        stripped === "-";

      if (isOnlyEcho) {
        return;
      }

      // Special check for show counts: do not complete on silence if counts have not arrived yet
      if (
        lowerCmd.startsWith("show counts") &&
        !hasAllCounts(bufTrimmed) &&
        !/%ERROR|INVALID/i.test(bufTrimmed)
      ) {
        return;
      }

      // Special check for show <device>: do not complete on silence if PRIMARY STATUS has not arrived
      if (
        lowerCmd.startsWith("show") &&
        !lowerCmd.startsWith("show counts")
      ) {
        const hasError = /%ERROR|INVALID|NOT FOUND|ACCESS DENIED/i.test(bufTrimmed);
        const hasPrimaryStatus = /PRIMARY STATUS\s*(?::|\s)\s*(NORM|FIRE|DIRT|DISA|DISABLE|ABNOR|NO\s*ANS|SUP|OPEN|SHORT|TEST|OFF|ON|ACTIVE|INACT|UNVER)/i.test(bufTrimmed);

        if (!hasError && !hasPrimaryStatus) {
          return;
        }
      }

      // Special check for list: if expectedCount is specified, keep collecting unless silence has elapsed with sufficient data
      if (lowerCmd.startsWith("list")) {
        const exp = activeCommand.expectedCount || 0;
        const addressMatches = bufTrimmed.match(/(?:^|\n)\s*(?:\d+:)?(?:M\d+-\d+(?:-\d+)?|P\d+|\d+-\d+(?:-\d+)?)\b/g);
        const count = addressMatches ? addressMatches.length : 0;
        if (exp > 0 && count < Math.floor(exp * 0.95)) {
          // Still waiting for full list data from panel — do not finish early on silence
          return;
        }
      }

      completeActiveCommand();
    }, 500);
  }
}

function disconnect() {
  failSuspendedDump("Disconnected");
  if (socket) {
    const prev = socket;
    socket = null;
    parser?.flush();
    parser = null;
    prev.removeAllListeners();
    prev.destroy();
  }
  if (activeCommand) {
    clearCommandTimers(activeCommand);
    post({
      type: "result",
      id: activeCommand.id,
      ok: false,
      error: "Disconnected",
    });
    activeCommand = null;
  }
  post({ type: "connected", connected: false, host: currentHost, port: currentPort });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

parentPort?.on("message", (msg: IncomingMessage) => {
  if (msg.type === "connect") {
    const connectId = msg.id ?? "connect";
    void connect(msg.host, msg.port)
      .then(() => {
        parentPort?.postMessage({
          type: "result",
          id: connectId,
          ok: true,
          response: `connected ${currentHost}:${currentPort}`,
        });
      })
      .catch((err: Error) => {
        parentPort?.postMessage({
          type: "result",
          id: connectId,
          ok: false,
          error: err.message || "Failed to connect to fire panel",
        });
      });
    return;
  }

  if (msg.type === "disconnect") {
    disconnect();
    return;
  }

  if (msg.type === "command") {
    // A login already accepted on this connection within the last 3 minutes is
    // answered here without sending it again.
    if (isLoginCommand(msg.command) && loginSessionActive()) {
      post({
        type: "result",
        id: msg.id,
        ok: true,
        response: "ACCESS GRANTED (login still active)",
      });
      return;
    }
    enqueueCommand(msg);
    if (
      activeCommand &&
      rankFor(msg.command) < activeCommand.rank &&
      isPreemptibleDump(activeCommand.command)
    ) {
      preemptActiveDump(msg.command);
    }
    processNextCommand();
    return;
  }

  if (msg.type === "status") {
    post({
      type: "status",
      id: msg.id,
      connected: isSocketLive(socket),
      host: currentHost,
      port: currentPort,
    });
    return;
  }
});
