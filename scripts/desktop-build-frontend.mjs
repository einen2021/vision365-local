import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const apiDir = path.join(root, "src", "app", "api");
const apiBackup = path.join(root, "src", "app", "_api_web_only");

let moved = false;

function moveApiAside() {
  if (!fs.existsSync(apiDir)) return;
  if (fs.existsSync(apiBackup)) fs.rmSync(apiBackup, { recursive: true, force: true });
  fs.cpSync(apiDir, apiBackup, { recursive: true });
  fs.rmSync(apiDir, { recursive: true, force: true });
  moved = true;
  console.log("[desktop-build] Moved src/app/api aside (desktop uses desktop-server)");
}

function restoreApi() {
  if (!moved || !fs.existsSync(apiBackup)) return;
  if (fs.existsSync(apiDir)) fs.rmSync(apiDir, { recursive: true, force: true });
  fs.cpSync(apiBackup, apiDir, { recursive: true });
  fs.rmSync(apiBackup, { recursive: true, force: true });
  moved = false;
  console.log("[desktop-build] Restored src/app/api");
}

process.on("exit", restoreApi);
process.on("SIGINT", () => {
  restoreApi();
  process.exit(1);
});

try {
  moveApiAside();

  const result = spawnSync(
    "npx",
    ["cross-env", "DESKTOP_BUILD=1", "next", "build", "--webpack"],
    { cwd: root, stdio: "inherit", shell: true, env: { ...process.env, DESKTOP_BUILD: "1" } }
  );

  restoreApi();
  process.exit(result.status ?? 1);
} catch (err) {
  restoreApi();
  console.error(err);
  process.exit(1);
}
