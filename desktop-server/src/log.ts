import fs from "fs";
import path from "path";

let logFile: string | null = null;

export function initServerLog(logsDir: string) {
  fs.mkdirSync(logsDir, { recursive: true });
  logFile = path.join(logsDir, "server.log");
  fs.writeFileSync(logFile, `--- Vision365 server log ${new Date().toISOString()} ---\n`);
}

export function serverLog(message: string) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  process.stdout.write(line);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line);
    } catch {
      // ignore write errors
    }
  }
}

export function serverLogError(message: string) {
  const line = `[${new Date().toISOString()}] ERROR: ${message}\n`;
  process.stderr.write(line);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, line);
    } catch {
      // ignore
    }
  }
}
