/**
 * Download portable MongoDB Community Server for bundling with the desktop app.
 * Creates: src-tauri/resources/mongodb/bin/mongod(.exe)
 */
import { execSync, spawnSync } from "child_process";
import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const mongoResDir = path.join(root, "src-tauri", "resources", "mongodb");

// MongoDB 7.0.x Windows x64 (matches typical Tauri bundled binary)
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

function downloadWithCurl(url, dest) {
  const result = spawnSync(
    "curl",
    ["-fsSL", url, "-o", dest],
    { stdio: "inherit", shell: true },
  );
  if (result.status !== 0) {
    throw new Error(`curl download failed with code ${result.status}`);
  }
}

function downloadWithNode(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const request = (targetUrl) => {
      https
        .get(targetUrl, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            res.resume();
            request(res.headers.location);
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} downloading ${targetUrl}`));
            res.resume();
            return;
          }
          res.pipe(file);
          file.on("finish", () => file.close(() => resolve()));
        })
        .on("error", (err) => {
          try {
            fs.unlinkSync(dest);
          } catch {
            // ignore
          }
          reject(err);
        });
    };
    request(url);
  });
}

async function downloadZip(url, dest) {
  try {
    downloadWithCurl(url, dest);
  } catch (curlError) {
    console.warn(`[mongodb] curl failed (${curlError.message}) — trying Node https...`);
    await downloadWithNode(url, dest);
  }
}

function expandZip(zipPath, destDir) {
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`,
    { stdio: "inherit", shell: true },
  );
}

const versionFile = path.join(mongoResDir, ".mongo-version");
const mongodExe = path.join(mongoResDir, "bin", "mongod.exe");

if (
  fs.existsSync(mongodExe) &&
  fs.existsSync(versionFile) &&
  fs.readFileSync(versionFile, "utf-8").trim() === MONGO_VERSION
) {
  console.log(`[mongodb] mongod v${MONGO_VERSION} already present at ${mongodExe}`);
  process.exit(0);
}

if (process.platform !== "win32") {
  console.warn(
    `[mongodb] Portable download script currently supports Windows only (got ${process.platform}).`,
  );
  console.warn(
    "[mongodb] Falling back to mongodb-memory-server at runtime if bundled mongod is missing.",
  );
  process.exit(0);
}

fs.mkdirSync(mongoResDir, { recursive: true });
const zipPath = path.join(mongoResDir, ZIP_NAME);

console.log(`[mongodb] Downloading MongoDB ${MONGO_VERSION}...`);
console.log(`[mongodb] ${ZIP_URL}`);

try {
  await downloadZip(ZIP_URL, zipPath);
  expandZip(zipPath, mongoResDir);

  const extracted = path.join(
    mongoResDir,
    `mongodb-win32-x86_64-windows-${MONGO_VERSION}`,
  );
  const binSrc = path.join(extracted, "bin");
  const binDest = path.join(mongoResDir, "bin");

  if (!fs.existsSync(binSrc)) {
    throw new Error(`Expected extracted bin folder missing: ${binSrc}`);
  }

  if (fs.existsSync(binDest)) fs.rmSync(binDest, { recursive: true, force: true });
  copyDir(binSrc, binDest);
  fs.rmSync(extracted, { recursive: true, force: true });
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  fs.writeFileSync(versionFile, MONGO_VERSION);

  if (!fs.existsSync(mongodExe)) {
    throw new Error(`mongod.exe was not created at ${mongodExe}`);
  }

  console.log(`[mongodb] Portable mongod v${MONGO_VERSION} ready at ${mongodExe}`);
} catch (error) {
  console.error(`[mongodb] Download failed: ${error.message}`);
  console.warn(
    "[mongodb] Continuing without bundled mongod — runtime will retry or use memory-server.",
  );
  process.exit(0);
}
