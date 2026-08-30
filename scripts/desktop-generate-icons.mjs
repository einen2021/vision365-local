import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const iconsDir = path.join(root, "src-tauri", "icons");
const tauriDir = path.join(root, "src-tauri");

// Everything `tauri icon` writes directly into icons/ (leaves android/ and ios/
// subfolders alone — those hold more than just regenerable icon files).
const GENERATED_ICON_FILES = [
  "32x32.png",
  "64x64.png",
  "128x128.png",
  "128x128@2x.png",
  "icon.png",
  "icon.ico",
  "icon.icns",
  "Square30x30Logo.png",
  "Square44x44Logo.png",
  "Square71x71Logo.png",
  "Square89x89Logo.png",
  "Square107x107Logo.png",
  "Square142x142Logo.png",
  "Square150x150Logo.png",
  "Square284x284Logo.png",
  "Square310x310Logo.png",
  "StoreLogo.png",
];

/**
 * `tauri icon` regenerates these files by overwriting them in place. On
 * Windows, if anything else (Windows Search indexer, antivirus real-time
 * scan, OneDrive, a stale thumbnail handle, etc.) still has a memory-mapped
 * view open on the previous version of one of these files — most often
 * icon.icns, the largest one — the overwrite fails with os error 1224
 * ("cannot be performed on a file with a user-mapped section open").
 *
 * Deleting the old files first means `tauri icon` always *creates* a new
 * file instead of overwriting an existing (possibly still-mapped) one,
 * which avoids the failure instead of just hoping nothing is holding it.
 */
function removeExistingIcons() {
  for (const name of GENERATED_ICON_FILES) {
    const filePath = path.join(iconsDir, name);
    if (fs.existsSync(filePath)) {
      fs.rmSync(filePath, { force: true });
    }
  }
}

function runTauriIcon() {
  return spawnSync("npx", ["tauri", "icon", "../public/logo.png"], {
    cwd: tauriDir,
    stdio: "inherit",
    shell: true,
  });
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  removeExistingIcons();
  const result = runTauriIcon();

  if (result.status === 0) {
    process.exit(0);
  }

  if (attempt < MAX_ATTEMPTS) {
    console.warn(
      `[desktop-icons] tauri icon failed (attempt ${attempt}/${MAX_ATTEMPTS}) — retrying after a short delay...`,
    );
    // eslint-disable-next-line no-await-in-loop
    await sleep(RETRY_DELAY_MS);
  } else {
    console.error(`[desktop-icons] tauri icon failed after ${MAX_ATTEMPTS} attempts.`);
    process.exit(result.status ?? 1);
  }
}
