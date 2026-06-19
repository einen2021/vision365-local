import net from "net";
import { serverLog } from "../log";
import { alarmListsFingerprint, syncPanelAlarmsToDatabase, type AlarmSyncResult } from "./firePanelAlarmSync";

const TOTAL_FIRE = "cshow a0 cval\r";
const FIRE_LIST = "list f\n";
const TOTAL_TROUBLE = "cshow a2 cval\r";
const TROUBLE_LIST = "list t\n";
const TOTAL_SUPERVISORY = "cshow a1 cval\r";
const SUPERVISORY_LIST = "list s\n";

const CONNECT_DELAY_MS = 1000;
const COMMAND_TIMEOUT_MS = 2000;
const LIST_COMMAND_TIMEOUT_MS = 15000;
const BULK_COMMAND_TIMEOUT_MS = 60000;
/** Resolve when no bytes arrive for this long (panel finished sending) */
const IDLE_COMPLETE_MS = 400;
const LIST_IDLE_COMPLETE_MS = 800;

let oldFire = 0;
let oldTrouble = 0;
let oldSupervisory = 0;
let lastAlarmFingerprint = "";

let client: net.Socket | null = null;
let currentHost = "";
let currentPort = 23;
let readLogs: string[] = [];

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

function addLog(message: string) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  readLogs.push(line);
  if (readLogs.length > 300) readLogs = readLogs.slice(-300);
  serverLog(`[fire-panel] ${message}`);
}

function clearLogs() {
  readLogs = [];
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
      oldFire = 0;
      oldTrouble = 0;
      oldSupervisory = 0;
      clearLogs();
      attachSocketHandlers(socket);
      addLog(`Connected to ${host}:${port}`);

      // Wait for panel welcome banner before sending commands (like original script)
      setTimeout(() => {
        addLog("Ready — starting reads");
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
  lastAlarmFingerprint = "";
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
        if (response.length > 0) {
          finish("(idle)");
        }
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

async function readCategory(
  label: string,
  totalCmd: string,
  listCmd: string,
  oldCount: number,
  setOldCount: (n: number) => void,
) {
  addLog(`Reading ${label} count...`);
  try {
    const raw = await sendCommand(totalCmd);
    const match = raw.match(/CVAL=(\d+)/);
    if (!match) {
      addLog(`${label}: CVAL not found in response`);
      return { total: 0, raw, list: null, error: `${label} count not found` };
    }

    const count = Number(match[1]);
    addLog(`${label} count: ${count}`);
    let list: string | null = null;

    if (count > 0) {
      addLog(`Fetching ${label} list...`);
      list = await sendCommand(listCmd);
    }
    setOldCount(count);

    return { total: count, raw, list, count, error: null };
  } catch (err) {
    const msg = (err as Error).message;
    addLog(`${label} read error: ${msg}`);
    return { total: 0, raw: null, list: null, error: msg };
  }
}

export function getReadLogs() {
  return [...readLogs];
}

export async function readFirePanel() {
  ensureConnected();
  addLog("--- readPanel() start ---");

  const previousFireCount = oldFire;
  const fire = await readCategory(
    "Fire",
    TOTAL_FIRE,
    FIRE_LIST,
    oldFire,
    (n) => {
      oldFire = n;
    },
  );
  const trouble = await readCategory(
    "Trouble",
    TOTAL_TROUBLE,
    TROUBLE_LIST,
    oldTrouble,
    (n) => {
      oldTrouble = n;
    },
  );
  const supervisory = await readCategory(
    "Supervisory",
    TOTAL_SUPERVISORY,
    SUPERVISORY_LIST,
    oldSupervisory,
    (n) => {
      oldSupervisory = n;
    },
  );

  addLog("--- readPanel() done ---");

  const alarmPayload = {
    fire: { total: fire.total, list: fire.list },
    trouble: { total: trouble.total, list: trouble.list },
    supervisory: { total: supervisory.total, list: supervisory.list },
  };

  const fingerprint = alarmListsFingerprint(alarmPayload);
  let alarmSync: AlarmSyncResult = {
    matchedAssets: 0,
    buildingsUpdated: [],
    skipped: true,
  };

  if (fingerprint !== lastAlarmFingerprint) {
    alarmSync = await syncPanelAlarmsToDatabase(alarmPayload, { previousFireCount });
    lastAlarmFingerprint = fingerprint;
    if ((alarmSync.messagesAdded ?? 0) > 0) {
      addLog(`Added ${alarmSync.messagesAdded} fire alarm message(s) to alarmMessage`);
    }
  } else {
    addLog("Alarm lists unchanged — skipped database sync");
  }

  if (alarmSync.matchedAssets > 0) {
    addLog(
      `Synced ${alarmSync.matchedAssets} asset(s) across ${alarmSync.buildingsUpdated.length} building(s)`,
    );
  }

  return {
    host: currentHost,
    port: currentPort,
    polledAt: new Date().toISOString(),
    connected: Boolean(client),
    alarms: { fire, trouble, supervisory },
    alarmSync,
    logs: [...readLogs],
  };
}

export async function sendFirePanelCommand(
  command: string,
  timeoutMs?: number,
) {
  ensureConnected();
  addLog(`Manual command: ${command.trim()}`);
  const response = await sendCommand(command, timeoutMs);
  return { response, logs: [...readLogs] };
}
