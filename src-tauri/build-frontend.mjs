/**
 * Tauri beforeBuildCommand wrapper — cwd varies, so resolve project root from this file.
 */
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(root, "scripts", "desktop-build-frontend.mjs");

const result = spawnSync(process.execPath, [script], {
  cwd: root,
  stdio: "inherit",
});

process.exit(result.status ?? 1);
