/**
 * Bundle desktop-server + portable Node.js for MSI installs (no Node required on target PC).
 * Uses Node built-in node:sqlite — no mongodb package to ship.
 */
import * as esbuild from "esbuild";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { stripSeedToLoginOnly } from "../src/lib/defaultDbSeed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverResDir = path.join(root, "src-tauri", "resources", "server");
const nodeResDir = path.join(root, "src-tauri", "resources", "node");
const NODE_VERSION = "22.14.0";

// 1. Bundle server as CommonJS
fs.mkdirSync(serverResDir, { recursive: true });

await esbuild.build({
  entryPoints: [
    path.join(root, "desktop-server/src/index.ts"),
    path.join(root, "desktop-server/src/workers/firePanelWorker.ts"),
  ],
  bundle: true,
  platform: "node",
  target: "node20",
  outdir: serverResDir,
  entryNames: "[name]",
  format: "cjs",
  // Tauri production spawn looks for index.cjs (not .js).
  outExtension: { ".js": ".cjs" },
  // node:sqlite is a Node builtin — do not bundle it.
  external: ["node:sqlite"],
  sourcemap: false,
});

// Remove leftover Mongo-era artifacts / wrong extensions from older builds.
for (const stale of ["index.js", "firePanelWorker.js"]) {
  const stalePath = path.join(serverResDir, stale);
  if (fs.existsSync(stalePath)) {
    fs.unlinkSync(stalePath);
    console.log(`[bundle] Removed stale ${stale}`);
  }
}

console.log("[bundle] Built src-tauri/resources/server/*.cjs");

// 2. Ensure portable Node.js (22+ required for node:sqlite)
const nodeExe = path.join(nodeResDir, "node.exe");
ensurePortableNode(nodeExe);

// 3. Minimal runtime package.json (no native DB deps)
const runtimePkgPath = path.join(serverResDir, "package.json");
fs.writeFileSync(
  runtimePkgPath,
  JSON.stringify(
    {
      name: "vision365-server-runtime",
      private: true,
      type: "commonjs",
    },
    null,
    2,
  ),
);

// Remove leftover mongodb node_modules from older builds
const nodeModulesDest = path.join(serverResDir, "node_modules");
if (fs.existsSync(nodeModulesDest)) {
  fs.rmSync(nodeModulesDest, { recursive: true, force: true });
  console.log("[bundle] Removed legacy server node_modules");
}

// Verify node:sqlite works with bundled Node
execSync(
  `"${nodeExe}" -e "const { DatabaseSync } = require('node:sqlite'); const d = new DatabaseSync(':memory:'); d.exec('CREATE TABLE t(x)'); console.log('sqlite runtime ok');"`,
  { stdio: "inherit", shell: true },
);
console.log("[bundle] Verified node:sqlite runtime");

// 4. Copy login-only seed for first-run on installed machines
const seedSrc = path.join(root, "data", "db.json");
const seedDest = path.join(root, "src-tauri", "resources", "db-seed.json");
if (fs.existsSync(seedSrc)) {
  const raw = JSON.parse(fs.readFileSync(seedSrc, "utf-8"));
  const clean = stripSeedToLoginOnly(raw);
  fs.writeFileSync(seedDest, `${JSON.stringify(clean, null, 2)}\n`);
  console.log("[bundle] Wrote login-only db-seed.json for MSI first install");
}

console.log("[bundle] Desktop server runtime bundle complete");

function ensurePortableNode(nodeExePath) {
  const versionFile = path.join(nodeResDir, ".node-version");
  const needsDownload =
    !fs.existsSync(nodeExePath) ||
    !fs.existsSync(versionFile) ||
    fs.readFileSync(versionFile, "utf-8").trim() !== NODE_VERSION;

  if (!needsDownload) {
    console.log(`[bundle] node.exe v${NODE_VERSION} already present`);
    return;
  }

  if (fs.existsSync(nodeExePath)) fs.unlinkSync(nodeExePath);

  fs.mkdirSync(nodeResDir, { recursive: true });
  const zipName = `node-v${NODE_VERSION}-win-x64.zip`;
  const zipUrl = `https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`;
  const zipPath = path.join(nodeResDir, zipName);

  console.log(`[bundle] Downloading Node.js ${NODE_VERSION}...`);
  execSync(`curl -fsSL "${zipUrl}" -o "${zipPath}"`, { stdio: "inherit", shell: true });
  execSync(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${nodeResDir}' -Force"`,
    { stdio: "inherit", shell: true },
  );

  const extracted = path.join(nodeResDir, `node-v${NODE_VERSION}-win-x64`, "node.exe");
  fs.copyFileSync(extracted, nodeExePath);
  fs.rmSync(path.join(nodeResDir, `node-v${NODE_VERSION}-win-x64`), {
    recursive: true,
    force: true,
  });
  fs.unlinkSync(zipPath);
  fs.writeFileSync(versionFile, NODE_VERSION);
  console.log(`[bundle] Portable node.exe v${NODE_VERSION} ready`);
}
