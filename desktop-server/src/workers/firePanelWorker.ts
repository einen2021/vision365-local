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
  systemType?: "error" | "login-success" | "banner" | "command";
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
  | { type: "raw"; dir: "TX" | "RX"; text: string }
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
    // Any ACCESS GRANTED starts the login session — also one arriving late or
    // from a login typed by hand; ACCESS DENIED ends it.
    noteLoginLine(String(entry.raw || "").trim());
    // A live FIRE ALARM holds trouble / supervisory lists at once (fire priority).
    if (entry.kind === "fire" && !entry.isListEntry) setFireActive(true, "live FIRE ALARM");
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
        loginSession = null;
        resetOutputTracking();

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
// Sending commands
// ---------------------------------------------------------------------------
//
// The panel only runs a command typed at its "-" prompt. A command that arrives
// while it is busy (printing a response or an event) is echoed WITHOUT the
// leading "-" and ignored. So every command, one at a time in arrival order:
//   1. waits until the panel sits at its prompt (Enter recovers a hidden one),
//   2. is sent,
//   3. is confirmed by its echo: "- cmd" = executed, "cmd" = ignored → resend
//      (3 attempts), no echo = unknown → fail without resending (except login).
// See docs/PANEL_COMMANDS.md.

type CommandMessage = Extract<IncomingMessage, { type: "command" }>;

/** Wait after the prompt appears before sending, to be sure nothing follows it. */
const SETTLE_MS = 50;
/** Longest wait for the prompt before a command fails as "panel not ready". */
const PROMPT_WAIT_MS = 10_000;
/** No prompt for this long: press Enter to get a fresh one (repeats). */
const PROMPT_RECOVERY_MS = 2_000;
/** Longest wait for a command's echo. */
const ECHO_WAIT_MS = 5_000;
/** Tries for a command the panel explicitly ignored. */
const MAX_ATTEMPTS = 3;
/** Longest wait for the answer to `login 333`. */
const LOGIN_ANSWER_MS = 3_000;
/** Login tries before giving up. */
const LOGIN_ATTEMPTS = 5;
/** How long an ACCESS GRANTED is reused. */
const LOGIN_SESSION_MS = 3 * 60 * 1000;
/** Longest wait for a list (list f/t/s, cshow) to finish. */
const LIST_WAIT_MS = 60_000;
/** Longest wait for the rest of any other response (up to the next prompt). */
const RESPONSE_WAIT_MS = 5_000;
const CHUNK_POST_INTERVAL_MS = 100;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function cmdLog(message: string) {
  post({
    type: "panel-log",
    entry: { kind: "system", systemType: "command", raw: `CMD    ${message}`, at: new Date().toISOString() },
  });
}

// --- Panel output tracking --------------------------------------------------

/** Last part of the panel output (\r removed) — enough to see the last line. */
let outputTail = "";
/** Bumped on every chunk from the panel. */
let outputSeq = 0;
/** Something was written; the panel counts as busy until it prints a new prompt. */
let busyAfterWrite = false;
/** Output since the current command was written (null when nothing is waiting on it). */
let capture: { text: string } | null = null;
const outputWaiters = new Set<() => void>();

function wakeOutputWaiters() {
  for (const wake of [...outputWaiters]) wake();
}

/** Resolves on the next panel output, a disconnect, or after `ms`. */
function waitForOutput(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      outputWaiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    outputWaiters.add(done);
  });
}

/** True when the last line printed is exactly "-". */
function endsAtPrompt(text: string): boolean {
  const trimmed = text.replace(/\s+$/, "");
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1);
  return lastLine.trim() === "-";
}

function onPanelOutput(text: string) {
  const clean = text.replace(/\r/g, "");
  outputSeq += 1;
  outputTail = (outputTail + clean).slice(-512);
  if (busyAfterWrite && endsAtPrompt(outputTail)) busyAfterWrite = false;
  if (capture) capture.text += clean;
  wakeOutputWaiters();
}

function resetOutputTracking() {
  outputTail = "";
  busyAfterWrite = false;
  capture = null;
  wakeOutputWaiters();
}

function promptReady(): boolean {
  return isSocketLive(socket) && !busyAfterWrite && endsAtPrompt(outputTail);
}

/**
 * Start capturing output for a command about to be written. The capture begins
 * with the line already on screen — the "- " prompt — because the echo of a
 * command typed at the prompt completes that line ("- ack").
 */
function startCapture() {
  capture = { text: outputTail.slice(outputTail.lastIndexOf("\n") + 1) };
}

function requireSocket(): net.Socket {
  if (!isSocketLive(socket)) throw new Error("Fire panel not connected");
  return socket;
}

/** Write a line to the panel; from now on it is busy until it prints a prompt. */
function writeLine(line: string) {
  const sock = requireSocket();
  busyAfterWrite = true;
  flushRawRx();
  post({ type: "raw", dir: "TX", text: line });
  sock.write(`${line}\r\n`);
}

// --- Raw telnet trace (exactly what crossed the socket, line by line) -------

const RAW_RX_FLUSH_MS = 150;
let rawRxBuffer = "";
let rawRxTimer: ReturnType<typeof setTimeout> | null = null;

/** Show control bytes (other than tab) as <XX> so nothing is hidden. */
function visibleRaw(text: string): string {
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, (c) =>
    `<${c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()}>`,
  );
}

function flushRawRx() {
  if (rawRxTimer) {
    clearTimeout(rawRxTimer);
    rawRxTimer = null;
  }
  if (!rawRxBuffer) return;
  post({ type: "raw", dir: "RX", text: visibleRaw(rawRxBuffer) });
  rawRxBuffer = "";
}

/** Emit complete lines as they arrive; a trailing partial line (e.g. the "-" prompt) after a short idle. */
function traceRawRx(chunk: string) {
  rawRxBuffer += chunk;
  let idx: number;
  while ((idx = rawRxBuffer.indexOf("\n")) >= 0) {
    const line = rawRxBuffer.slice(0, idx).replace(/\r$/, "");
    rawRxBuffer = rawRxBuffer.slice(idx + 1);
    post({ type: "raw", dir: "RX", text: visibleRaw(line) });
  }
  if (rawRxTimer) clearTimeout(rawRxTimer);
  rawRxTimer = rawRxBuffer ? setTimeout(flushRawRx, RAW_RX_FLUSH_MS) : null;
}

/**
 * Wait until the panel sits at its "-" prompt, then 50 ms more with nothing new
 * printed. No prompt for 2 s → press Enter (repeats every 2 s); none in 10 s →
 * "panel not ready" (nothing is sent).
 */
async function waitForPrompt(): Promise<void> {
  const start = Date.now();
  let lastEnterAt = start;
  for (;;) {
    requireSocket();
    if (promptReady()) {
      const seq = outputSeq;
      await sleep(SETTLE_MS);
      if (promptReady() && outputSeq === seq) return;
      continue;
    }
    const now = Date.now();
    if (now - start >= PROMPT_WAIT_MS) {
      throw new Error(`Panel not ready: no "-" prompt within ${PROMPT_WAIT_MS / 1000}s`);
    }
    if (now - lastEnterAt >= PROMPT_RECOVERY_MS) {
      writeLine("");
      lastEnterAt = now;
    }
    await waitForOutput(Math.min(100, start + PROMPT_WAIT_MS - now));
  }
}

// --- Echo ------------------------------------------------------------------

function normalizeCommand(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * executed:    "- ack"  — typed at the prompt
 * ignored:     "ack"    — on its own line without the dash
 * interrupted: echoed inside other output ("… COS 21list f"): typed while the
 *              panel was printing an event, and it may still run it afterwards
 *              (seen with `list f`) — so its outcome is unknown.
 */
type EchoKind = "executed" | "ignored" | "interrupted";

/**
 * Look for the command's echo among the complete lines of `text`. Returns
 * where the echo line starts and where the output after it begins.
 */
function findEcho(
  text: string,
  command: string,
): { kind: EchoKind; start: number; end: number } | null {
  const want = normalizeCommand(command);
  let start = 0;
  for (;;) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) return null; // only complete lines count
    const line = text.slice(start, nl).replace(/\x00/g, "");
    const match = /^\s*(-?)\s*(.*)$/.exec(line);
    const dash = match?.[1] === "-";
    const rest = normalizeCommand(match?.[2] ?? "");
    if (rest === want) return { kind: dash ? "executed" : "ignored", start, end: nl + 1 };
    if (rest.endsWith(want)) return { kind: "interrupted", start, end: nl + 1 };
    start = nl + 1;
  }
}

/** Wait up to ECHO_WAIT_MS for the echo of `command` in the current capture. */
async function waitForEcho(command: string, ms = ECHO_WAIT_MS) {
  const deadline = Date.now() + ms;
  for (;;) {
    requireSocket();
    const echo = capture ? findEcho(capture.text, command) : null;
    if (echo) return echo;
    const left = deadline - Date.now();
    if (left <= 0) return null;
    await waitForOutput(left);
  }
}

// --- Responses -------------------------------------------------------------

/** ack / set / silence print nothing of their own — done once executed. */
function isEchoOnly(command: string): boolean {
  return /^(ack|set|silence)\b/i.test(command);
}

/** Commands that only read from the panel — safe to send again. */
function isReadOnly(command: string): boolean {
  return /^(list|show|cshow)\b/i.test(command);
}

function isListCommand(command: string): boolean {
  return /^(list|cshow)\b/i.test(command);
}

/**
 * Collect the response after the echo up to the next "-" prompt (lists: up to
 * LIST_WAIT_MS, streamed to the caller as it grows; others: RESPONSE_WAIT_MS).
 * On timeout what arrived so far is returned.
 */
async function collectResponse(msg: CommandMessage, command: string, echoStart: number, echoEnd: number) {
  const isList = isListCommand(command);
  const deadline = Date.now() + (isList ? LIST_WAIT_MS : RESPONSE_WAIT_MS);
  let lastChunkAt = 0;
  let lastChunkLength = -1;
  for (;;) {
    const text = capture?.text ?? "";
    const response = text.slice(echoStart);
    const afterEcho = text.slice(echoEnd);
    if (endsAtPrompt(afterEcho)) {
      if (isList) post({ type: "chunk", id: msg.id, response, done: true });
      return response;
    }
    if (isList && response.length !== lastChunkLength && Date.now() - lastChunkAt >= CHUNK_POST_INTERVAL_MS) {
      post({ type: "chunk", id: msg.id, response, done: false });
      lastChunkAt = Date.now();
      lastChunkLength = response.length;
    }
    requireSocket();
    const left = deadline - Date.now();
    if (left <= 0) {
      cmdLog(`${command}   response did not end with a "-" prompt within ${Math.round((isList ? LIST_WAIT_MS : RESPONSE_WAIT_MS) / 1000)}s — returning what arrived`);
      if (isList) post({ type: "chunk", id: msg.id, response, done: true });
      return response;
    }
    await waitForOutput(Math.min(left, CHUNK_POST_INTERVAL_MS));
  }
}

/** Send one command: wait for the prompt, send, confirm by echo, collect its response. */
async function runCommand(msg: CommandMessage, command: string): Promise<string> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await waitForPrompt();
    startCapture();
    writeLine(command);
    cmdLog(`${command}   sent (attempt ${attempt})`);

    const echo = await waitForEcho(command);
    if (!echo || echo.kind === "interrupted") {
      const what = echo
        ? `echoed inside other panel output (panel was busy, it may still run it)`
        : `no echo received`;
      // Reading (list / show) twice is harmless; anything that changes the
      // panel is never resent when it may already have run.
      if (isReadOnly(command) && attempt < MAX_ATTEMPTS) {
        cmdLog(`${command}   ${what}, retrying`);
        continue;
      }
      throw new Error(
        `${echo ? "Echo interrupted" : "No echo received"} for '${command}'; execution status is unknown, not resent`,
      );
    }
    if (echo.kind === "ignored") {
      cmdLog(`${command}   IGNORED by panel (no "-" prompt)${attempt < MAX_ATTEMPTS ? ", retrying" : ""}`);
      continue;
    }
    cmdLog(`- ${command}   EXECUTED`);
    if (isEchoOnly(command)) return (capture?.text ?? "").slice(echo.start, echo.end);
    return collectResponse(msg, command, echo.start, echo.end);
  }
  throw new Error(`'${command}' was ignored by the panel ${MAX_ATTEMPTS} times`);
}

// --- Login -----------------------------------------------------------------

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

/** Any ACCESS GRANTED starts the 3-minute session; ACCESS DENIED ends it. */
function noteLoginLine(systemLine: string) {
  if (/^ACCESS\s+GRANTED\s*$/i.test(systemLine) && socket) {
    loginSession = { socket, at: Date.now() };
  } else if (/^ACCESS\s+DENIED\b/i.test(systemLine)) {
    loginSession = null;
  }
}

type LoginAnswer = "granted" | "denied" | "error" | "ignored" | "no answer";

async function waitForLoginAnswer(command: string, sentAt: number): Promise<LoginAnswer> {
  const deadline = sentAt + LOGIN_ANSWER_MS;
  for (;;) {
    requireSocket();
    const text = capture?.text ?? "";
    if (/ACCESS\s+GRANTED/i.test(text) || (loginSession && loginSession.at >= sentAt)) return "granted";
    if (/ACCESS\s+DENIED/i.test(text)) return "denied";
    if (/%ERROR/i.test(text)) return "error";
    if (findEcho(text, command)?.kind === "ignored") return "ignored";
    const left = deadline - Date.now();
    if (left <= 0) return "no answer";
    await waitForOutput(left);
  }
}

/**
 * Skipped while a login is active (3 min after ACCESS GRANTED). Otherwise sent
 * and answered within 3 s; anything but ACCESS GRANTED is retried, up to 5
 * attempts — logging in twice is harmless, so a missing echo is retried too.
 */
async function runLogin(command: string): Promise<string> {
  if (loginSessionActive()) {
    const left = Math.round((LOGIN_SESSION_MS - (Date.now() - loginSession!.at)) / 1000);
    const note = `already logged in (${left}s left), login skipped`;
    cmdLog(note);
    return note;
  }
  for (let attempt = 1; attempt <= LOGIN_ATTEMPTS; attempt++) {
    await waitForPrompt();
    startCapture();
    const sentAt = Date.now();
    writeLine(command);
    cmdLog(`${command}   sent (attempt ${attempt})`);

    const answer = await waitForLoginAnswer(command, sentAt);
    if (answer === "granted") {
      if (socket) loginSession = { socket, at: Date.now() };
      cmdLog(`${command} -> ACCESS GRANTED (attempt ${attempt})`);
      return capture?.text || "ACCESS GRANTED";
    }
    if (answer === "denied") loginSession = null;
    cmdLog(`${command} -> ${answer.toUpperCase()} (attempt ${attempt})${attempt < LOGIN_ATTEMPTS ? ", retrying" : ""}`);
  }
  throw new Error(`Login failed after ${LOGIN_ATTEMPTS} attempts`);
}

// --- Fire priority -----------------------------------------------------------

/**
 * While the panel reports FIRE > 0, `list t` / `list s` are never sent: queued
 * ones are refused and new ones are refused when their turn comes. Set by a
 * live FIRE ALARM line or a `show counts` reply with FIRE > 0; cleared only by
 * a `show counts` reply with FIRE = 0. The app re-lists trouble / supervisory
 * itself once the fire count is 0.
 */
let fireActive = false;

function isTroubleSupervisoryList(command: string): boolean {
  return /^list\s+[ts]\b/i.test(command.trim());
}

function fireHoldError(command: string): string {
  return `Fire alarm active (FIRE > 0): '${command}' not sent — trouble / supervisory lists wait until the fire count is 0`;
}

function setFireActive(active: boolean, reason: string) {
  if (fireActive === active) return;
  fireActive = active;
  cmdLog(`FIRE PRIORITY ${active ? "ON" : "OFF"} (${reason}) — list t / list s ${active ? "held" : "allowed"}`);
  if (!active) return;
  for (let i = commandQueue.length - 1; i >= 0; i--) {
    const queued = commandQueue[i];
    if (!isTroubleSupervisoryList(queued.command)) continue;
    commandQueue.splice(i, 1);
    const error = fireHoldError(queued.command.trim());
    cmdLog(`${queued.command.trim()}   NOT SENT: ${error}`);
    postResult(queued.id, { ok: false, error });
  }
}

/** FIRE from a complete `show counts` reply (all three totals present), or null. */
function fireCountFromShowCounts(response: string): number | null {
  const fire = /FIRE\s*=\s*(\d+)/i.exec(response);
  const supervisory = /SUPERVISORY\s*=\s*(\d+)/i.exec(response);
  const trouble = /TROUBLE\s*=\s*(\d+)[ \t]*[\r\n]/i.exec(response);
  if (!fire || !supervisory || !trouble) return null;
  return Number(fire[1]);
}

// --- Queue -----------------------------------------------------------------

/** Commands run one at a time, in the order they arrived. */
const commandQueue: CommandMessage[] = [];
/**
 * Only one `show counts` waits in the queue at a time: later requests share the
 * answer of the one already waiting (queued msg id -> extra request ids).
 */
const sharedResultIds = new Map<string, string[]>();

/** Post a command's result to its caller and to every request sharing it. */
function postResult(
  id: string,
  result: { ok: true; response: string } | { ok: false; error: string },
) {
  const ids = [id, ...(sharedResultIds.get(id) ?? [])];
  sharedResultIds.delete(id);
  for (const each of ids) post({ type: "result", id: each, ...result });
}
let activeCommandText: string | null = null;
let pumping = false;

async function executeCommand(msg: CommandMessage) {
  const command = msg.command.replace(/[\r\n]+/g, " ").trim();
  if (fireActive && isTroubleSupervisoryList(command)) {
    const error = fireHoldError(command);
    cmdLog(`${command}   NOT SENT: ${error}`);
    postResult(msg.id, { ok: false, error });
    return;
  }
  activeCommandText = command;
  try {
    let response: string;
    if (!command) {
      // A blank line by hand (empty command box): Enter, to get a fresh prompt.
      writeLine("");
      response = "OK";
    } else if (isLoginCommand(command)) {
      response = await runLogin(command);
    } else {
      response = await runCommand(msg, command);
    }
    if (normalizeCommand(command) === "show counts") {
      const fire = fireCountFromShowCounts(response);
      if (fire !== null) setFireActive(fire > 0, `show counts FIRE = ${fire}`);
    }
    postResult(msg.id, { ok: true, response });
  } catch (error) {
    const message = (error as Error)?.message || "Command failed";
    cmdLog(`${command || "(enter)"}   FAILED: ${message}`);
    postResult(msg.id, { ok: false, error: message });
  } finally {
    activeCommandText = null;
    capture = null;
  }
}

async function pumpCommands() {
  if (pumping) return;
  pumping = true;
  try {
    while (commandQueue.length > 0) {
      await executeCommand(commandQueue.shift()!);
    }
  } finally {
    pumping = false;
  }
}

function enqueueCommand(msg: CommandMessage) {
  if (normalizeCommand(msg.command) === "show counts") {
    const waiting = commandQueue.find((queued) => normalizeCommand(queued.command) === "show counts");
    if (waiting) {
      sharedResultIds.set(waiting.id, [...(sharedResultIds.get(waiting.id) ?? []), msg.id]);
      return;
    }
  }
  commandQueue.push(msg);
  void pumpCommands();
}

/** Fail everything still queued (the running command fails on its own). */
function failQueuedCommands(error: string) {
  while (commandQueue.length > 0) {
    const msg = commandQueue.shift()!;
    postResult(msg.id, { ok: false, error });
  }
}

function attachSocketHandlers(sock: net.Socket) {
  sock.on("close", () => {
    if (socket !== sock) return;
    parser?.flush();
    parser = null;
    socket = null;
    loginSession = null;
    resetOutputTracking();
    failQueuedCommands("Socket closed");
    post({ type: "connected", connected: false, host: currentHost, port: currentPort });
  });

  sock.on("error", (err: NodeJS.ErrnoException) => {
    if (socket !== sock) return;
    const msg = err?.message || "";
    if (/ECONNRESET|EPIPE|ETIMEDOUT/i.test(msg)) {
      parser?.flush();
      parser = null;
      socket = null;
      loginSession = null;
      resetOutputTracking();
      post({ type: "connected", connected: false, host: currentHost, port: currentPort });
    }
  });

  // Feed all incoming panel data into the parser & the command being confirmed.
  sock.on("data", (chunk: Buffer) => {
    traceRawRx(chunk.toString("utf8"));
    // Replies to device queries (show <address>, cshow, disable, enable) are not
    // alarm events — keep them away from the spontaneous-event parser.
    const lowerCmd = activeCommandText?.toLowerCase() ?? "";
    const isInteractiveQuery =
      lowerCmd.startsWith("show") ||
      lowerCmd.startsWith("cshow") ||
      lowerCmd.startsWith("disable") ||
      lowerCmd.startsWith("enable");
    if (!isInteractiveQuery) parser?.feed(chunk);

    onPanelOutput(chunk.toString("utf8"));
  });
}

function disconnect() {
  if (socket) {
    const prev = socket;
    socket = null;
    parser?.flush();
    parser = null;
    prev.removeAllListeners();
    prev.destroy();
  }
  loginSession = null;
  resetOutputTracking();
  failQueuedCommands("Disconnected");
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
    enqueueCommand(msg);
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
