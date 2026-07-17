import net from "net";
import { parentPort } from "worker_threads";

type IncomingMessage =
  | { type: "connect"; id?: string; host: string; port: number }
  | { type: "disconnect" }
  | { type: "status"; id: string }
  | {
      type: "command";
      id: string;
      command: string;
      timeoutMs?: number;
      /** For list f/t/s: keep waiting until this many device rows arrive. */
      expectedCount?: number;
    };

/** How long TCP connect may take before we fail (panel offline / wrong IP). */
const TCP_CONNECT_TIMEOUT_MS = 10000;

type OutgoingMessage =
  | { type: "connected"; connected: boolean; host: string; port: number }
  | { type: "status"; id: string; connected: boolean; host: string; port: number }
  | { type: "chunk"; id: string; response: string; done: boolean }
  | { type: "result"; id: string; ok: true; response: string }
  | { type: "result"; id: string; ok: false; error: string };

const CONNECT_DELAY_MS = 300;
const COMMAND_TIMEOUT_MS = 2000;
/**
 * Soft timeout for list commands: reset on each data chunk so slow dumps keep going.
 * Absolute ceiling still applies so a stuck panel cannot hang forever.
 */
const LIST_COMMAND_TIMEOUT_MS = 120000;
const LIST_COMMAND_ABSOLUTE_MS = 300000;
const SHOW_COMMAND_TIMEOUT_MS = 8000;
const BULK_COMMAND_TIMEOUT_MS = 60000;
/** Resolve when no bytes arrive for this long (panel finished sending) */
const IDLE_COMPLETE_MS = 100;
const SHOW_IDLE_COMPLETE_MS = 300;
const CVAL_IDLE_COMPLETE_MS = 450;
const LIST_IDLE_COMPLETE_MS = 250;
/**
 * After at least one list row arrives, finish if the panel goes quiet this long
 * even without full CVAL / _DNE — stream what we have to the UI.
 */
const LIST_IDLE_AFTER_ROWS_MS = 800;

let client: net.Socket | null = null;
let currentHost = "";
let currentPort = 23;
let connectInFlight: Promise<void> | null = null;

/** Serialize telnet commands — only one in flight on the socket at a time.
 * Priority jobs (ack / silence / login) jump ahead of queued list/CVAL work.
 */
type QueuedCommand = {
  priority: boolean;
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

/** Drop not-yet-started list/CVAL jobs so ack can run first. */
function deferPendingNonPriorityCommands(reason: string) {
  if (commandQueue.length === 0) return;
  const kept: QueuedCommand[] = [];
  let deferred = 0;
  for (const job of commandQueue) {
    if (!job.priority) {
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
      `[fire-panel] deferred ${deferred} queued command(s): ${reason}`,
    );
  }
  commandQueue = kept;
}

function enqueueCommand<T>(
  fn: () => Promise<T>,
  options: { priority?: boolean } = {},
): Promise<T> {
  const priority = Boolean(options.priority);

  return new Promise<T>((resolve, reject) => {
    const job: QueuedCommand = {
      priority,
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
      let settled = false;

      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        try {
          socket.destroy();
        } catch {
          // ignore
        }
        reject(err);
      };

      socket.setKeepAlive(true, 15000);
      socket.setNoDelay(true);
      // Fail fast if the panel never accepts the TCP connection.
      socket.setTimeout(TCP_CONNECT_TIMEOUT_MS);
      socket.once("timeout", () => {
        fail(
          new Error(
            `Connection timed out after ${TCP_CONNECT_TIMEOUT_MS / 1000}s (${host}:${port})`,
          ),
        );
      });
      socket.once("error", (err) => fail(err));
      socket.connect(port, host, () => {
        if (settled) return;
        settled = true;
        // After connect succeeds, disable the connect timeout (idle traffic is fine).
        socket.setTimeout(0);
        client = socket;
        currentHost = host;
        currentPort = port;
        attachSocketHandlers(socket);
        // Brief settle so the panel can send its initial banner before commands.
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
    /^set\s+p21[27]\s+on$/i.test(trimmed)
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
  return /_DNE|_END\b/i.test(sanitizePanelText(response));
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
    return hasCompleteShowFields(text);
  }
  // Ack / silence / set usually echo quickly — do not wait for a long idle.
  if (
    trimmed.startsWith("ack") ||
    trimmed.startsWith("silence") ||
    /^set\s+p21[27]\s+on$/i.test(trimmed)
  ) {
    return text.trim().length > 0;
  }
  return false;
}

function isListCommand(command: string) {
  return cleanCommandText(command).toLowerCase().startsWith("list");
}

/** True when the dump already contains at least one device address row. */
function listHasDeviceRows(response: string) {
  return /\b\d*:?M\d+-\d+(?:-\d+)?\b/i.test(sanitizePanelText(response));
}

/** Count device rows in a list dump (approx. matches client parsePanelListResponse). */
function countListMessages(response: string) {
  const text = sanitizePanelText(response);
  let count = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/_DNE|_END\b/i.test(trimmed)) continue;
    if (/^list\s/i.test(trimmed)) continue;
    if (/\b\d*:?M\d+-\d+(?:-\d+)?\b/i.test(trimmed)) count += 1;
  }
  return count;
}

/**
 * Complete when we have ~CVAL messages, or _DNE, or (fallback) rows + idle.
 * expectedCount comes from totalFire / totalTrouble / totalSupervisory.
 */
function isListCountReady(response: string, expectedCount?: number) {
  if (isDefiniteComplete(response)) return true;
  if (
    typeof expectedCount === "number" &&
    Number.isFinite(expectedCount) &&
    expectedCount > 0 &&
    countListMessages(response) >= expectedCount
  ) {
    return true;
  }
  return false;
}

/** True for Asset Control `show <address>`. */
function isShowCommand(command: string) {
  return cleanCommandText(command).toLowerCase().startsWith("show");
}

/**
 * Fire-critical panel commands — must not wait behind a long list dump.
 * Asset Control `show` is separate but also preempts lists (see sendCommand).
 */
function isPriorityCommand(command: string) {
  const trimmed = cleanCommandText(command).toLowerCase();
  return (
    trimmed.startsWith("ack") ||
    trimmed.startsWith("silence") ||
    trimmed.startsWith("login") ||
    /^set\s+p21[27]\s+on$/i.test(trimmed)
  );
}

/** Match PRIMARY STATUS / ENABLED STATE even with one space (no colon). */
function hasCompleteShowFields(response: string) {
  const text = sanitizePanelText(response);
  return (
    /PRIMARY\s+STATUS\s*:?\s+\S/i.test(text) &&
    /ENABLED\s+STATE\s*:?\s+\S/i.test(text)
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
  forcePriority?: boolean,
) {
  // Allow the service layer to explicitly mark ack/silence as priority even if
  // the heuristic doesn't catch the exact command text.
  const priority = Boolean(forcePriority) || isPriorityCommand(command);
  const isShow = isShowCommand(command);

  // Make room for fire ack / Asset Control show: stop the active list dump and
  // drop queued non-priority jobs so ack f is not stuck behind list t.
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
    if (priority) {
      deferPendingNonPriorityCommands("Deferred for priority command");
    }
  }

  return enqueueCommand(
    async () => {
      // Brief settle after preempt so leftover list bytes are less likely to
      // pollute the next response.
      if (priority || isShow) {
        await new Promise((resolve) => setTimeout(resolve, 120));
      }
      return sendCommandOnce(command, timeoutMs, commandId, expectedCount);
    },
    { priority: priority || isShow },
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
  const hasExpected =
    isList &&
    typeof expectedCount === "number" &&
    Number.isFinite(expectedCount) &&
    expectedCount > 0;
  // List soft timeout resets on every chunk; absolute ceiling stops a hung panel.
  const absoluteMaxMs = isList
    ? Math.max(maxWaitMs, LIST_COMMAND_ABSOLUTE_MS)
    : maxWaitMs;

  return new Promise<string>((resolve, reject) => {
    let response = "";
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let hardTimeout: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    let lastChunkPost = 0;
    const startedAt = Date.now();
    const streamingList = isList && Boolean(commandId);

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

    // Same as finish — used as the preempt hook identity.
    function finishEarly() {
      console.warn(
        `[fire-panel] list preempted after ${Date.now() - startedAt}ms (${response.length} chars) — returning best effort`,
      );
      finish();
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
      // Only settle quickly once we already have ~CVAL messages (or _DNE path).
      // Do NOT use a short idle when still short of CVAL — large dumps pause between batches.
      const countReady = isListCountReady(response, expectedCount);
      const waitMs =
        isList && countReady
          ? 200 // got CVAL amount — brief window for trailing _DNE
          : idleMs;
      idleTimer = setTimeout(() => {
        if (response.length === 0) return;

        if (isList) {
          if (isDefiniteComplete(response) || isListCountReady(response, expectedCount)) {
            finish();
            return;
          }
          // Known CVAL target and still short: keep reading (soft timeout handles stopped panels).
          if (hasExpected) {
            return;
          }
          // No CVAL target: finish on quiet after rows so UI does not hang.
          if (listHasDeviceRows(response)) {
            console.warn(
              `[fire-panel] list idle after rows (${Date.now() - startedAt}ms) — have ${countListMessages(response)} messages — completing`,
            );
            finish();
            return;
          }
          return;
        }

        // CVAL responses often arrive in multiple chunks — wait until CVAL= is present
        if (isCvalCommand(command) && !/CVAL\s*=\s*\d+/i.test(response)) {
          scheduleIdleComplete();
          return;
        }
        if (isShowCommand(command) && !hasCompleteShowFields(response)) {
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
      // Soft timeout resets on every chunk. If quiet while still short of CVAL, take best effort.
      if (isList && response.length > 0 && !isListCountReady(response, expectedCount)) {
        console.warn(
          `[fire-panel] list soft-timeout after idle (${Date.now() - startedAt}ms) — have ${countListMessages(response)}${hasExpected ? `/${expectedCount}` : ""} messages — completing best effort`,
        );
        finish();
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
      // While short of CVAL, allow longer gaps between telnet batches (panel dumps slowly).
      // Soft timer still resets on every chunk so continuous dumps keep going.
      let wait = maxWaitMs;
      if (isList && listHasDeviceRows(response)) {
        if (hasExpected && !isListCountReady(response, expectedCount)) {
          wait = Math.min(maxWaitMs, 90000);
        } else {
          wait = Math.min(maxWaitMs, 12000);
        }
      }
      hardTimeout = setTimeout(onHardTimeout, wait);
    };

    // Absolute ceiling for list dumps only (CVAL/ack/show use their own soft timeout).
    const absoluteTimeout = setTimeout(() => {
      if (settled) return;
      if (!isList) {
        onHardTimeout();
        return;
      }
      console.warn(
        `[fire-panel] list absolute timeout after ${absoluteMaxMs}ms (${response.length} chars, ${countListMessages(response)} messages) — returning best effort`,
      );
      if (response.length > 0) {
        finish();
        return;
      }
      fail(new Error("Timeout waiting for response"));
    }, absoluteMaxMs);

    armSoftTimeout();

    function onData(data: Buffer) {
      response += data.toString();

      // Keep waiting as long as the panel is still dumping list rows.
      if (isList) {
        armSoftTimeout();
      }

      if (streamingList) {
        const now = Date.now();
        const text = data.toString();
        const hasNewline = text.includes("\n") || text.includes("\r");
        const ready = isListCountReady(response, expectedCount);
        if (hasNewline || ready || now - lastChunkPost >= 120) {
          emitChunk(ready);
        }
      }

      if (isList) {
        if (isDefiniteComplete(response)) {
          finish();
          return;
        }
        // Hit CVAL count — settle briefly then finish (do not wait forever for _DNE).
        if (isListCountReady(response, expectedCount)) {
          scheduleIdleComplete();
          return;
        }
        scheduleIdleComplete();
        return;
      }

      if (isDefiniteComplete(response)) {
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
    const connectId = msg.id || "connect";
    void connect(msg.host, msg.port)
      .then(() => {
        post({
          type: "result",
          id: connectId,
          ok: true,
          response: `connected ${currentHost}:${currentPort}`,
        });
      })
      .catch((err) => {
        post({
          type: "result",
          id: connectId,
          ok: false,
          error: (err as Error).message || "Failed to connect to fire panel",
        });
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

    void sendCommand(msg.command, msg.timeoutMs, msg.id, msg.expectedCount, msg.priority)
      .then((response) => post({ type: "result", id: msg.id, ok: true, response }))
      .catch((err) => post({ type: "result", id: msg.id, ok: false, error: (err as Error).message }));
  }
});

