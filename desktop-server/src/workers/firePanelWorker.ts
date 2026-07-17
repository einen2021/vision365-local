import net from "net";
import { parentPort } from "worker_threads";

type IncomingMessage =
  | { type: "connect"; host: string; port: number }
  | { type: "disconnect" }
  | { type: "status"; id: string }
  | {
      type: "command";
      id: string;
      command: string;
      timeoutMs?: number;
      /** For list f/t/s: wait until this many device rows arrive (from CVAL). */
      expectedCount?: number;
    };

type OutgoingMessage =
  | { type: "connected"; connected: boolean; host: string; port: number }
  | { type: "status"; id: string; connected: boolean; host: string; port: number }
  | { type: "chunk"; id: string; response: string; done: boolean }
  | { type: "result"; id: string; ok: true; response: string }
  | { type: "result"; id: string; ok: false; error: string };

const CONNECT_DELAY_MS = 300;
const COMMAND_TIMEOUT_MS = 2000;
/**
 * Soft timeout for list commands: wait until the dump ends with "\n -" (or _DNE)
 * so the full list is kept. Soft timer resets on each chunk. Absolute is a long
 * safety ceiling only.
 */
const LIST_COMMAND_TIMEOUT_MS = 30000;
/** Large trouble lists (200+) can take several minutes to dump. */
const LIST_COMMAND_ABSOLUTE_MS = 300000;
const SHOW_COMMAND_TIMEOUT_MS = 8000;
const BULK_COMMAND_TIMEOUT_MS = 60000;
/** Resolve when no bytes arrive for this long (panel finished sending) */
const IDLE_COMPLETE_MS = 100;
const SHOW_IDLE_COMPLETE_MS = 300;
const CVAL_IDLE_COMPLETE_MS = 450;
const LIST_IDLE_COMPLETE_MS = 250;
/**
 * After the end marker arrives, brief quiet window then finish.
 */
const LIST_IDLE_AFTER_END_MS = 200;

/** Real list f/t/s message: address + following text (location / device / status). */
const LIST_MESSAGE_LINE_RE = /\b(?:\d+:)?M\d+-\d+(?:-\d+)?\s+\S+/i;

/** Normalize Simplex CR/LF so list rows split correctly (panel often uses \r only). */
function normalizeListText(text: string) {
  return sanitizePanelText(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** True when the last non-empty line is the panel prompt "-" (or _DNE/_END). */
function hasListDumpEndMarker(response: string) {
  const text = normalizeListText(response);
  if (/_DNE|_END\b/i.test(text)) return true;
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return false;
  // Exact prompt line — do not treat hyphens inside addresses/locations as the end.
  return lines[lines.length - 1] === "-";
}

let client: net.Socket | null = null;
let currentHost = "";
let currentPort = 23;
let connectInFlight: Promise<void> | null = null;

/**
 * Priority-aware command queue (not plain FIFO).
 * Ack/silence/login jump ahead of queued list/CVAL work so fire ack is not slow.
 */
type QueuedCommand = {
  priority: boolean;
  isList: boolean;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

let commandQueue: QueuedCommand[] = [];
let commandPumpRunning = false;

/** Active command fail handlers — cleared when the socket drops mid-command. */
const activeCommandFails = new Set<(err: Error) => void>();

/**
 * When a list dump is in flight, priority commands (ack / silence / login)
 * call this to finish early so fire ack is not stuck behind list t (200+ rows).
 */
let preemptActiveList: (() => void) | null = null;

function resetCommandQueue(reason?: string) {
  const err = new Error(reason || "Not connected");
  for (const job of commandQueue) {
    try {
      job.reject(err);
    } catch {
      // ignore
    }
  }
  commandQueue = [];
}

function failActiveCommands(reason: string) {
  const err = new Error(reason);
  for (const fail of [...activeCommandFails]) {
    try {
      fail(err);
    } catch {
      // ignore
    }
  }
  activeCommandFails.clear();
}

/** Drop not-yet-started list jobs so ack can run, then a clean post-ack list f. */
function deferPendingListCommands(reason: string) {
  if (commandQueue.length === 0) return;
  const kept: QueuedCommand[] = [];
  let deferred = 0;
  for (const job of commandQueue) {
    if (!job.priority && job.isList) {
      deferred += 1;
      try {
        job.reject(new Error(reason));
      } catch {
        // ignore
      }
    } else {
      kept.push(job);
    }
  }
  if (deferred > 0) {
    console.warn(
      `[fire-panel] deferred ${deferred} queued list command(s): ${reason}`,
    );
  }
  commandQueue = kept;
}

function enqueueCommand<T>(
  fn: () => Promise<T>,
  options: { priority?: boolean; isList?: boolean } = {},
): Promise<T> {
  const priority = Boolean(options.priority);
  const isList = Boolean(options.isList);

  return new Promise<T>((resolve, reject) => {
    const job: QueuedCommand = {
      priority,
      isList,
      run: fn,
      resolve: resolve as (value: unknown) => void,
      reject,
    };

    if (priority) {
      // Insert after other priority jobs, before any non-priority work.
      let insertAt = 0;
      while (insertAt < commandQueue.length && commandQueue[insertAt].priority) {
        insertAt += 1;
      }
      commandQueue.splice(insertAt, 0, job);
    } else {
      commandQueue.push(job);
    }

    void pumpCommandQueue();
  });
}

async function pumpCommandQueue() {
  if (commandPumpRunning) return;
  commandPumpRunning = true;
  try {
    while (commandQueue.length > 0) {
      const job = commandQueue.shift();
      if (!job) break;
      try {
        const result = await job.run();
        job.resolve(result);
      } catch (err) {
        job.reject(err as Error);
      }
    }
  } finally {
    commandPumpRunning = false;
    // A job may have been queued while we were clearing the running flag.
    if (commandQueue.length > 0) {
      void pumpCommandQueue();
    }
  }
}

function isSocketLive(socket: net.Socket | null) {
  return Boolean(socket && !socket.destroyed && socket.writable);
}

async function connect(host: string, port: number) {
  if (isSocketLive(client) && currentHost === host && currentPort === port) {
    post({ type: "connected", connected: true, host: currentHost, port: currentPort });
    return;
  }

  if (connectInFlight) {
    await connectInFlight;
    if (!isSocketLive(client)) {
      throw new Error("Failed to connect to fire panel");
    }
    return;
  }

  connectInFlight = (async () => {
    if (client) {
      client.removeAllListeners("close");
      client.removeAllListeners("error");
      client.destroy();
      client = null;
    }

    await new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      socket.setKeepAlive(true, 15000);
      socket.setNoDelay(true);
      // Detect dead peers faster on Windows LAN drops.
      socket.setTimeout(0);
      socket.once("error", (err) => reject(err));
      socket.connect(port, host, () => {
        client = socket;
        currentHost = host;
        currentPort = port;
        attachSocketHandlers(socket);
        setTimeout(resolve, CONNECT_DELAY_MS);
      });
    });

    post({ type: "connected", connected: true, host: currentHost, port: currentPort });
  })();

  try {
    await connectInFlight;
  } finally {
    connectInFlight = null;
  }
}

function post(msg: OutgoingMessage) {
  parentPort?.postMessage(msg);
}

/** Remove hidden control chars (paste/JSON) and collapse whitespace. */
function cleanCommandText(command: string) {
  return command
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function timeoutForCommand(command: string, overrideMs?: number) {
  if (overrideMs && overrideMs > 0) return overrideMs;
  const trimmed = cleanCommandText(command).toLowerCase();
  if (trimmed.includes("cshow *") || trimmed.includes("cshow*"))
    return BULK_COMMAND_TIMEOUT_MS;
  if (trimmed.startsWith("list")) return LIST_COMMAND_TIMEOUT_MS;
  if (trimmed.startsWith("show")) return SHOW_COMMAND_TIMEOUT_MS;
  if (trimmed.startsWith("cshow") && trimmed.includes("cval")) return 3000;
  // Ack / silence / login should never sit on a long soft timeout.
  if (
    trimmed.startsWith("ack") ||
    trimmed.startsWith("silence") ||
    trimmed.startsWith("login") ||
    /^set\s+\d+:p21[27]\s+on$/i.test(trimmed)
  ) {
    return 3000;
  }
  return COMMAND_TIMEOUT_MS;
}

function idleMsForCommand(command: string) {
  const trimmed = cleanCommandText(command).toLowerCase();
  if (isCvalCommand(command)) return CVAL_IDLE_COMPLETE_MS;
  if (trimmed.startsWith("show")) return SHOW_IDLE_COMPLETE_MS;
  if (
    trimmed.startsWith("list") ||
    trimmed.includes("cshow *") ||
    trimmed.includes("cshow*")
  ) {
    return LIST_IDLE_COMPLETE_MS;
  }
  return IDLE_COMPLETE_MS;
}

function isDefiniteComplete(response: string) {
  return hasListDumpEndMarker(response);
}

/** NUL-padded panel columns look blank in logs but break \s-based matching. */
function sanitizePanelText(text: string) {
  return String(text || "").replace(/\0/g, " ");
}

function isQuickComplete(command: string, response: string) {
  const trimmed = cleanCommandText(command).toLowerCase();
  const text = sanitizePanelText(response);
  if (trimmed.startsWith("cshow") && trimmed.includes("cval")) {
    return /CVAL\s*=\s*\d+/i.test(text);
  }
  if (trimmed.startsWith("login")) {
    return /ACCESS GRANTED/i.test(text) || /INVALID PASSCODE/i.test(text);
  }
  if (trimmed.startsWith("show")) {
    // Accept "PRIMARY STATUS: X", "PRIMARY STATUS  X", or "PRIMARY STATUS X".
    return (
      /PRIMARY\s+STATUS\s*:?\s+\S/i.test(text) &&
      /ENABLED\s+STATE\s*:?\s+\S/i.test(text)
    );
  }
  // Ack / silence / set usually echo quickly — do not wait for a long idle.
  if (
    trimmed.startsWith("ack") ||
    trimmed.startsWith("silence") ||
    /^set\s+\d+:p21[27]\s+on$/i.test(trimmed)
  ) {
    return text.trim().length > 0;
  }
  return false;
}

function isListCommand(command: string) {
  return cleanCommandText(command).toLowerCase().startsWith("list");
}

function isShowCommand(command: string) {
  return cleanCommandText(command).toLowerCase().startsWith("show");
}

/**
 * Discard leftover telnet bytes (e.g. after a preempted list) before the next
 * command, so Asset Control `show` is not completed by a stale "-" prompt.
 */
function drainSocketQuiet(ms: number) {
  return new Promise<void>((resolve) => {
    const socket = client;
    if (!isSocketLive(socket)) {
      resolve();
      return;
    }
    const onData = () => {
      // discard
    };
    socket!.on("data", onData);
    setTimeout(() => {
      socket!.removeListener("data", onData);
      resolve();
    }, ms);
  });
}

/** True when the dump already contains at least one real list message line. */
function listHasDeviceRows(response: string) {
  return LIST_MESSAGE_LINE_RE.test(normalizeListText(response));
}

/** Count device rows in a list dump (must split CR / address boundaries correctly). */
function countListMessages(response: string) {
  const text = normalizeListText(response);
  // Same address-boundary split as the client — fixed-width dumps may lack newlines.
  const broken = text.replace(/((?:\d+:)?M\d+-\d+(?:-\d+)?\s+)/gi, "\n$1");
  let count = 0;
  for (const line of broken.split("\n")) {
    const trimmed = line.replace(/\s+/g, " ").trim();
    if (!trimmed) continue;
    if (/_DNE|_END\b/i.test(trimmed)) continue;
    if (trimmed === "-") continue;
    if (/^list\s/i.test(trimmed)) continue;
    if (LIST_MESSAGE_LINE_RE.test(trimmed)) count += 1;
  }
  return count;
}

/**
 * Finish when we have the full dump:
 * - If expectedCount (CVAL) is known: wait until that many message rows arrive
 * - Otherwise: wait for the panel prompt line "-" / _DNE
 * Never stop on the first row alone.
 */
function isListFormatReady(response: string, expectedCount?: number) {
  const count = countListMessages(response);
  const hasExpected =
    typeof expectedCount === "number" &&
    Number.isFinite(expectedCount) &&
    expectedCount > 0;

  if (hasExpected) {
    return count >= expectedCount;
  }

  return hasListDumpEndMarker(response);
}

/** Fire-critical panel commands — must not wait behind a long list dump. */
function isPriorityCommand(command: string) {
  const trimmed = cleanCommandText(command).toLowerCase();
  return (
    trimmed.startsWith("ack") ||
    trimmed.startsWith("silence") ||
    trimmed.startsWith("login") ||
    // e.g. "set 2:p212 on" / "set 3:p217 on"
    /^set\s+\d+:p21[27]\s+on$/i.test(trimmed)
  );
}

function isCvalCommand(command: string) {
  const trimmed = cleanCommandText(command).toLowerCase();
  return trimmed.startsWith("cshow") && trimmed.includes("cval");
}

// Panel service port expects CR (PuTTY default). LF causes login passcode failures.
function normalizeCommand(command: string) {
  const cleaned = cleanCommandText(command);
  if (!cleaned) return "\r";
  return `${cleaned}\r`;
}

function ensureConnected() {
  if (!isSocketLive(client)) {
    throw new Error("Not connected");
  }
}

function attachSocketHandlers(socket: net.Socket) {
  socket.on("close", () => {
    if (client !== socket) return;
    client = null;
    failActiveCommands("Not connected");
    // Reset command queue so a reconnect is not blocked by a hung prior command.
    resetCommandQueue("Not connected");
    post({ type: "connected", connected: false, host: currentHost, port: currentPort });
  });
  socket.on("error", (err) => {
    // Keep the socket unless the panel closed it — commands report their own errors.
    if (client === socket && /ECONNRESET|EPIPE|ETIMEDOUT/i.test(err.message || "")) {
      client = null;
      failActiveCommands(err.message || "Not connected");
      resetCommandQueue(err.message || "Not connected");
      post({ type: "connected", connected: false, host: currentHost, port: currentPort });
    }
  });
}

function disconnect() {
  if (client) {
    client.removeAllListeners("close");
    client.removeAllListeners("error");
    client.end();
    client.destroy();
    client = null;
  }
  failActiveCommands("Not connected");
  resetCommandQueue("Not connected");
  post({ type: "connected", connected: false, host: currentHost, port: currentPort });
}

function sendCommand(
  command: string,
  timeoutMs?: number,
  commandId?: string,
  expectedCount?: number,
) {
  const priority = isPriorityCommand(command);
  const isList = isListCommand(command);
  const isShow = isShowCommand(command);

  // Make room for ack / Asset Control show: stop the active list dump and drop
  // queued list jobs so PRIMARY STATUS is not stuck behind list t.
  if (priority || isShow) {
    if (preemptActiveList) {
      console.warn(
        `[fire-panel] preempting in-flight list for ${priority ? "priority" : "show"} command: ${cleanCommandText(command)}`,
      );
      try {
        preemptActiveList();
      } catch {
        // ignore — list may already be finishing
      }
    }
    deferPendingListCommands("List preempted");
  }

  return enqueueCommand(
    async () => {
      // Brief settle after preempt / before show so leftover list bytes are less
      // likely to pollute the next command response.
      if (priority || isShow) {
        await drainSocketQuiet(100);
      }
      return sendCommandOnce(command, timeoutMs, commandId, expectedCount);
    },
    // Show jumps ahead of queued CVAL/list so the modal status loads quickly.
    { priority: priority || isShow, isList },
  );
}

function sendCommandOnce(
  command: string,
  timeoutMs?: number,
  commandId?: string,
  expectedCount?: number,
) {
  ensureConnected();
  const socket = client as net.Socket;
  const normalized = normalizeCommand(command);
  const maxWaitMs = timeoutForCommand(command, timeoutMs);
  const idleMs = idleMsForCommand(command);
  const isList = isListCommand(command);
  // List: soft wait resets while listening; absolute is a long safety ceiling.
  const absoluteMaxMs = isList ? LIST_COMMAND_ABSOLUTE_MS : maxWaitMs;

  return new Promise<string>((resolve, reject) => {
    let response = "";
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let lastChunkPost = 0;
    const startedAt = Date.now();
    const streamingList = isList && Boolean(commandId);
    const listReady = () => isListFormatReady(response, expectedCount);

    const emitChunk = (done: boolean) => {
      if (!streamingList || !commandId) return;
      post({ type: "chunk", id: commandId, response, done });
      lastChunkPost = Date.now();
    };

    const clearPreemptHook = () => {
      if (preemptActiveList === finishEarly) preemptActiveList = null;
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      clearPreemptHook();
      activeCommandFails.delete(fail);
      if (hardTimeout) clearTimeout(hardTimeout);
      clearTimeout(absoluteTimeout);
      if (idleTimer) clearTimeout(idleTimer);
      socket.removeListener("data", onData);
      if (streamingList) emitChunk(true);
      // Return NUL-cleaned text so Asset Control can parse PRIMARY STATUS / ENABLED STATE.
      const cleaned = cleanCommandText(command).toLowerCase().startsWith("show")
        ? sanitizePanelText(response)
        : // Also clean NULs from list dumps so the UI parser sees full rows.
          isList
          ? sanitizePanelText(response)
          : response;
      resolve(cleaned);
    };

    // Preempt hook: yield the socket to ack/silence. Return rows if we have any;
    // otherwise abort so post-ack list f can run cleanly.
    function finishEarly() {
      const elapsed = Date.now() - startedAt;
      if (isDefiniteComplete(response) || listHasDeviceRows(response)) {
        console.warn(
          `[fire-panel] list preempted after ${elapsed}ms — returning ${countListMessages(response)} message(s)`,
        );
        finish();
        return;
      }
      console.warn(
        `[fire-panel] list preempted after ${elapsed}ms (${response.length} chars) — no message yet, aborting`,
      );
      fail(new Error("List preempted"));
    }

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearPreemptHook();
      activeCommandFails.delete(fail);
      if (hardTimeout) clearTimeout(hardTimeout);
      clearTimeout(absoluteTimeout);
      if (idleTimer) clearTimeout(idleTimer);
      socket.removeListener("data", onData);
      reject(err);
    };

    activeCommandFails.add(fail);
    if (isList) {
      preemptActiveList = finishEarly;
    }

    const scheduleIdleComplete = () => {
      if (idleTimer) clearTimeout(idleTimer);
      // List: settle briefly once CVAL count / end marker says the dump is complete.
      const waitMs = isList && listReady() ? LIST_IDLE_AFTER_END_MS : idleMs;
      idleTimer = setTimeout(() => {
        if (response.length === 0) return;

        if (isList) {
          if (listReady()) {
            finish();
            return;
          }
          // Still short of CVAL count / end marker — keep listening.
          return;
        }

        // CVAL responses often arrive in multiple chunks — wait until CVAL= is present
        if (isCvalCommand(command) && !/CVAL\s*=\s*\d+/i.test(response)) {
          scheduleIdleComplete();
          return;
        }
        if (
          cleanCommandText(command).toLowerCase().startsWith("show") &&
          !(
            /PRIMARY\s+STATUS\s*:?\s+\S/i.test(sanitizePanelText(response)) &&
            /ENABLED\s+STATE\s*:?\s+\S/i.test(sanitizePanelText(response))
          )
        ) {
          scheduleIdleComplete();
          return;
        }
        finish();
      }, waitMs);
    };

    const onHardTimeout = () => {
      // Never return a partial `show` — Asset Control needs PRIMARY STATUS + ENABLED STATE.
      if (cleanCommandText(command).toLowerCase().startsWith("show")) {
        if (isQuickComplete(command, response)) {
          finish();
          return;
        }
        fail(new Error("Timeout waiting for complete show response"));
        return;
      }
      // List: keep waiting until CVAL count / end marker (absolute ceiling is the backstop).
      if (isList) {
        if (listReady()) {
          console.warn(
            `[fire-panel] list soft-timeout complete after ${Date.now() - startedAt}ms — ${countListMessages(response)} message(s)`,
          );
          finish();
          return;
        }
        console.warn(
          `[fire-panel] list still waiting after ${Date.now() - startedAt}ms (${countListMessages(response)}${expectedCount ? `/${expectedCount}` : ""} messages, ${response.length} chars) — continuing`,
        );
        armSoftTimeout();
        return;
      }
      if (response.length > 0) {
        finish();
        return;
      }
      fail(new Error("Timeout waiting for response"));
    };

    const armSoftTimeout = () => {
      if (hardTimeout) clearTimeout(hardTimeout);
      hardTimeout = setTimeout(onHardTimeout, maxWaitMs);
    };

    // Absolute ceiling — return what we have if any rows arrived.
    const absoluteTimeout = setTimeout(() => {
      if (settled) return;
      if (!isList) {
        onHardTimeout();
        return;
      }
      if (listReady() || listHasDeviceRows(response)) {
        console.warn(
          `[fire-panel] list absolute timeout after ${absoluteMaxMs}ms — completing with ${countListMessages(response)}${expectedCount ? `/${expectedCount}` : ""} message(s), ready=${listReady()}`,
        );
        finish();
        return;
      }
      console.warn(
        `[fire-panel] list absolute timeout after ${absoluteMaxMs}ms — no list message line (${response.length} chars)`,
      );
      fail(new Error("Timeout waiting for list message response"));
    }, absoluteMaxMs);

    armSoftTimeout();

    function onData(data: Buffer) {
      response += data.toString();

      if (isList) {
        armSoftTimeout();
      }

      if (streamingList) {
        const now = Date.now();
        const text = data.toString();
        const hasNewline = text.includes("\n") || text.includes("\r");
        const hasRows = listHasDeviceRows(response);
        const ready = listReady();
        // Stream rows to the UI one-by-one; ready=true only when dump is complete.
        if (hasNewline || ready || hasRows || now - lastChunkPost >= 120) {
          emitChunk(ready);
        }
      }

      if (isList) {
        // Stop when CVAL count is met (or end marker when count unknown).
        if (listReady()) {
          scheduleIdleComplete();
          return;
        }
        scheduleIdleComplete();
        return;
      }

      const isShow = cleanCommandText(command).toLowerCase().startsWith("show");

      // List prompt "-" must NOT complete `show` — leftover bytes after a preempted
      // list dump often end with "-" and would return before PRIMARY STATUS arrives.
      if (!isShow && isDefiniteComplete(response)) {
        finish();
        return;
      }

      if (isQuickComplete(command, response)) {
        scheduleIdleComplete();
        return;
      }

      scheduleIdleComplete();
    }

    socket.on("data", onData);
    socket.write(normalized, (err) => {
      if (err) fail(err);
    });
  });
}

function shouldAcceptCommand(_command: string) {
  return true;
}

parentPort?.on("message", (msg: IncomingMessage) => {
  if (msg.type === "connect") {
    void connect(msg.host, msg.port).catch((err) => {
      post({ type: "result", id: "connect", ok: false, error: (err as Error).message });
    });
    return;
  }

  if (msg.type === "disconnect") {
    disconnect();
    return;
  }

  if (msg.type === "status") {
    post({
      type: "status",
      id: msg.id,
      connected: isSocketLive(client),
      host: currentHost,
      port: currentPort,
    });
    return;
  }

  if (msg.type === "command") {
    if (!shouldAcceptCommand(msg.command)) {
      post({
        type: "result",
        id: msg.id,
        ok: false,
        error: "Worker refused command",
      });
      return;
    }

    void sendCommand(msg.command, msg.timeoutMs, msg.id, msg.expectedCount)
      .then((response) => post({ type: "result", id: msg.id, ok: true, response }))
      .catch((err) => post({ type: "result", id: msg.id, ok: false, error: (err as Error).message }));
  }
});

