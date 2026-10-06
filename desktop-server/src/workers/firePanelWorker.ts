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

interface PendingCommand {
  id: string;
  command: string;
  buffer: string;
  expectedCount?: number;
  /** Original per-gap budget — reused to extend timeoutTimer while a list dump is still progressing. */
  timeoutMs: number;
  timeoutTimer: NodeJS.Timeout;
  silenceTimer: NodeJS.Timeout | null;
  priority?: boolean;
  /** Highest list-row address count seen so far, for progress-based deadline extension. */
  lastProgressCount?: number;
}

let activeCommand: PendingCommand | null = null;
const commandQueue: Array<{
  msg: Extract<IncomingMessage, { type: "command" }>;
}> = [];

function completeActiveCommand() {
  if (!activeCommand) return;
  const cmd = activeCommand;
  activeCommand = null;

  if (cmd.timeoutTimer) clearTimeout(cmd.timeoutTimer);
  if (cmd.silenceTimer) clearTimeout(cmd.silenceTimer);

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

  processNextCommand();
}

function processNextCommand() {
  if (activeCommand) return;
  if (commandQueue.length === 0) return;
  const next = commandQueue.shift();
  if (next) {
    executeCommand(next.msg);
  }
}

/**
 * Ack/silence commands must reach the panel immediately — waiting behind a
 * slow in-flight command (e.g. a hundreds-of-rows "list" dump) would delay a
 * life-safety acknowledgement by many seconds. Cancel whatever is currently
 * active so the priority command can be sent right away; the cancelled
 * command's caller gets a "deferred for priority command" error and can
 * retry on its own next cycle instead of blocking the ack.
 */
function cancelActiveCommandForPriority() {
  if (!activeCommand) return;
  const cmd = activeCommand;
  activeCommand = null;

  if (cmd.timeoutTimer) clearTimeout(cmd.timeoutTimer);
  if (cmd.silenceTimer) clearTimeout(cmd.silenceTimer);

  // Unblock streaming callers (list commands) waiting on a final chunk.
  if (cmd.command.toLowerCase().startsWith("list")) {
    post({ type: "chunk", id: cmd.id, response: cmd.buffer, done: true });
  }

  post({
    type: "result",
    id: cmd.id,
    ok: false,
    error: `Command deferred for priority command: ${cmd.command}`,
  });
}

function executeCommand(msg: Extract<IncomingMessage, { type: "command" }>) {
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

  // Fast-path: ack commands are written immediately and return OK in 0ms (no response needed)
  const isAck = /^(ack\b|ack$)/i.test(clean);
  if (isAck) {
    socket.write(`${clean}\r\n`, (err) => {
      if (err) {
        post({ type: "result", id: msg.id, ok: false, error: err.message });
      } else {
        post({ type: "result", id: msg.id, ok: true, response: "OK" });
      }
    });
    processNextCommand();
    return;
  }

  // Interactive commands (login, show, disable, enable, list) require collecting panel output
  const timeoutMs = msg.timeoutMs && msg.timeoutMs > 0 ? msg.timeoutMs : 5000;

  activeCommand = {
    id: msg.id,
    command: clean,
    buffer: "",
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
  };

  socket.write(`${clean}\r\n`, (err) => {
    if (err && activeCommand && activeCommand.id === msg.id) {
      if (activeCommand.timeoutTimer) clearTimeout(activeCommand.timeoutTimer);
      if (activeCommand.silenceTimer) clearTimeout(activeCommand.silenceTimer);
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
      if (activeCommand.timeoutTimer) clearTimeout(activeCommand.timeoutTimer);
      if (activeCommand.silenceTimer) clearTimeout(activeCommand.silenceTimer);
      post({
        type: "result",
        id: activeCommand.id,
        ok: false,
        error: "Socket closed while waiting for response",
      });
      activeCommand = null;
    }
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
        activeCommand.command.toLowerCase().startsWith("enable") ||
        activeCommand.command.toLowerCase().startsWith("set"));

    if (!isInteractiveQuery) {
      parser?.feed(chunk);
    }

    // 2. If an active command is waiting for response, collect the chunk
    if (activeCommand) {
      const text = chunk.toString("utf8");
      activeCommand.buffer += text;

      const trimmed = activeCommand.buffer.trim();
      const lowerCmd = activeCommand.command.toLowerCase();

      let isComplete = false;

      if (lowerCmd.startsWith("login")) {
        if (/ACCESS GRANTED|ACCESS DENIED|%ERROR|INVALID|ALREADY|LEVEL/i.test(trimmed) || trimmed.endsWith("-") || /\n-\s*$/.test(trimmed)) {
          isComplete = true;
        }
      } else if (lowerCmd.startsWith("set")) {
        if (/COMMAND ACCEPTED|%ERROR|INVALID|ALREADY|ON|OFF/i.test(trimmed) || trimmed.endsWith("-") || /\n-\s*$/.test(trimmed)) {
          isComplete = true;
        }
      } else if (lowerCmd.startsWith("show counts")) {
        if (
          (/FIRE\s*=\s*\d+/i.test(trimmed) || /TROUBLE\s*=\s*\d+/i.test(trimmed) || /SUPERVISORY\s*=\s*\d+/i.test(trimmed)) &&
          (trimmed.endsWith("-") || /-\s*$/.test(trimmed) || /_DNE|_END/i.test(trimmed) || trimmed.includes("\n-"))
        ) {
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
        post({ type: "chunk", id: activeCommand.id, response: activeCommand.buffer, done: false });

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
          !/FIRE\s*=\s*\d+|TROUBLE\s*=\s*\d+|SUPERVISORY\s*=\s*\d+|%ERROR/i.test(bufTrimmed)
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
  if (activeCommand) {
    if (activeCommand.timeoutTimer) clearTimeout(activeCommand.timeoutTimer);
    if (activeCommand.silenceTimer) clearTimeout(activeCommand.silenceTimer);
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
    if (!activeCommand) {
      executeCommand(msg);
    } else {
      commandQueue.push({ msg });
    }
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
