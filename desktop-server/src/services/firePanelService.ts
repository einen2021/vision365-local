import net from "net";
import { serverLog } from "../log";

const CONNECT_DELAY_MS = 300;
const COMMAND_TIMEOUT_MS = 2000;
const LIST_COMMAND_TIMEOUT_MS = 15000;
const BULK_COMMAND_TIMEOUT_MS = 60000;
/** Resolve when no bytes arrive for this long (panel finished sending) */
const IDLE_COMPLETE_MS = 100;
const LIST_IDLE_COMPLETE_MS = 250;

let client: net.Socket | null = null;
let currentHost = "";
let currentPort = 23;

/** Serialize telnet commands — only one in flight on the socket at a time */
let commandChain: Promise<unknown> = Promise.resolve();

function enqueueCommand<T>(fn: () => Promise<T>): Promise<T> {
  const run = commandChain.then(fn, fn);
  commandChain = run.catch(() => {});
  return run;
}

function timeoutForCommand(command: string, overrideMs?: number) {
  if (overrideMs && overrideMs > 0) return overrideMs;
  const trimmed = command.trim().toLowerCase();
  if (trimmed.includes("cshow *") || trimmed.includes("cshow*"))
    return BULK_COMMAND_TIMEOUT_MS;
  if (trimmed.startsWith("list")) return LIST_COMMAND_TIMEOUT_MS;
  if (trimmed.startsWith("cshow") && trimmed.includes("cval")) return 3000;
  return COMMAND_TIMEOUT_MS;
}

function idleMsForCommand(command: string) {
  const trimmed = command.trim().toLowerCase();
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
  return /_DNE/i.test(response);
}

function isQuickComplete(command: string, response: string) {
  const trimmed = command.trim().toLowerCase();
  if (trimmed.startsWith("cshow") && trimmed.includes("cval")) {
    return /CVAL=\d+/i.test(response);
  }
  return false;
}

function isListCommand(command: string) {
  return command.trim().toLowerCase().startsWith("list");
}

function isCvalCommand(command: string) {
  const trimmed = command.trim().toLowerCase();
  return trimmed.startsWith("cshow") && trimmed.includes("cval");
}

function logCvalPresence(command: string, response: string) {
  if (!isCvalCommand(command)) return;
  const match = response.match(/CVAL=(\d+)/i);
  if (match) {
    addLog(`CVAL present in response: CVAL=${match[1]}`);
  } else {
    addLog("CVAL not present in response");
  }
}

function addLog(message: string) {
  serverLog(`[fire-panel] ${message}`);
}

// trim() strips \r/\n — never use it on commands that already have line endings
function normalizeCommand(command: string) {
  if (command.endsWith("\r") || command.endsWith("\n")) {
    return command;
  }
  const trimmed = command.trim();
  if (trimmed.startsWith("cshow")) return `${trimmed}\r`;
  return `${trimmed}\n`;
}

function ensureConnected() {
  if (!client) {
    throw new Error("Not connected");
  }
}

function attachSocketHandlers(socket: net.Socket) {
  socket.on("close", () => {
    addLog("Socket closed");
    client = null;
  });
  socket.on("error", (err) => {
    addLog(`Socket error: ${err.message}`);
  });
}

export function connectFirePanel(host: string, port: number) {
  if (client) {
    client.destroy();
    client = null;
  }

  return new Promise<void>((resolve, reject) => {
    const socket = new net.Socket();
    socket.setKeepAlive(true);

    socket.once("error", (err) => {
      reject(err);
    });

    socket.connect(port, host, () => {
      client = socket;
      currentHost = host;
      currentPort = port;
      attachSocketHandlers(socket);
      addLog(`Connected to ${host}:${port}`);

      // Wait for panel welcome banner before sending commands (like original script)
      setTimeout(() => {
        addLog("Ready");
        resolve();
      }, CONNECT_DELAY_MS);
    });
  });
}

export function disconnectFirePanel() {
  if (client) {
    client.removeAllListeners("close");
    client.end();
    client.destroy();
    client = null;
    addLog("Disconnected");
  }
}

export function getFirePanelStatus() {
  return {
    connected: Boolean(client),
    host: currentHost,
    port: currentPort,
  };
}

function sendCommand(command: string, timeoutMs?: number) {
  return enqueueCommand(() => sendCommandOnce(command, timeoutMs));
}

function sendCommandOnce(command: string, timeoutMs?: number) {
  ensureConnected();
  const socket = client as net.Socket;
  const normalized = normalizeCommand(command);
  const maxWaitMs = timeoutForCommand(command, timeoutMs);
  const idleMs = idleMsForCommand(command);

  return new Promise<string>((resolve, reject) => {
    let response = "";
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;

    addLog(`>> ${JSON.stringify(normalized)}`);

    const finish = (label: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (idleTimer) clearTimeout(idleTimer);
      socket.removeListener("data", onData);
      logCvalPresence(normalized, response);
      addLog(
        `<< ${label} ${response.slice(0, 300)}${response.length > 300 ? "..." : ""}`,
      );
      resolve(response);
    };

    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      if (idleTimer) clearTimeout(idleTimer);
      socket.removeListener("data", onData);
      reject(err);
    };

    const scheduleIdleComplete = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (response.length === 0) return;
        // List output ends with _DNE — keep reading until the panel marks done
        if (isListCommand(normalized) && !isDefiniteComplete(response)) {
          return;
        }
        finish("(idle)");
      }, idleMs);
    };

    const hardTimeout = setTimeout(() => {
      if (response.length > 0) {
        finish("(timeout, partial)");
        return;
      }
      addLog("<< TIMEOUT (no data)");
      fail(new Error("Timeout waiting for response"));
    }, maxWaitMs);

    function onData(data: Buffer) {
      response += data.toString();

      if (isDefiniteComplete(response)) {
        finish("");
        return;
      }

      if (isQuickComplete(normalized, response)) {
        scheduleIdleComplete();
        return;
      }

      scheduleIdleComplete();
    }

    socket.on("data", onData);
    socket.write(normalized, (err) => {
      if (err) {
        addLog(`Write error: ${err.message}`);
        fail(err);
      }
    });
  });
}

export async function sendFirePanelCommand(
  command: string,
  timeoutMs?: number,
) {
  ensureConnected();
  addLog(`Manual command: ${command.trim()}`);
  const response = await sendCommand(command, timeoutMs);
  return { response };
}
