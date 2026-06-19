/**
 * Download portable MongoDB Community Server for bundling with the desktop app.
 */
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mongoResDir = path.join(root, "src-tauri", "resources", "mongodb");

// MongoDB 7.0.x Windows x64
const MONGO_VERSION = "7.0.18";
const ZIP_NAME = `mongodb-windows-x86_64-${MONGO_VERSION}.zip`;
const ZIP_URL = `https://fastdl.mongodb.org/windows/${ZIP_NAME}`;

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

const versionFile = path.join(mongoResDir, ".mongo-version");
const mongodExe = path.join(mongoResDir, "bin", "mongod.exe");

if (
  fs.existsSync(mongodExe) &&
  fs.existsSync(versionFile) &&
  fs.readFileSync(versionFile, "utf-8").trim() === MONGO_VERSION
) {
  console.log(`[mongodb] mongod v${MONGO_VERSION} already present`);
  process.exit(0);
}

fs.mkdirSync(mongoResDir, { recursive: true });
const zipPath = path.join(mongoResDir, ZIP_NAME);

console.log(`[mongodb] Downloading MongoDB ${MONGO_VERSION}...`);
execSync(`curl -fsSL "${ZIP_URL}" -o "${zipPath}"`, { stdio: "inherit", shell: true });
execSync(
  `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${mongoResDir}' -Force"`,
  { stdio: "inherit", shell: true }
);

const extracted = path.join(mongoResDir, `mongodb-win32-x86_64-windows-${MONGO_VERSION}`);
const binSrc = path.join(extracted, "bin");
const binDest = path.join(mongoResDir, "bin");

if (fs.existsSync(binDest)) fs.rmSync(binDest, { recursive: true, force: true });
copyDir(binSrc, binDest);
fs.rmSync(extracted, { recursive: true, force: true });
fs.unlinkSync(zipPath);
fs.writeFileSync(versionFile, MONGO_VERSION);

console.log(`[mongodb] Portable mongod v${MONGO_VERSION} ready at ${mongodExe}`);
