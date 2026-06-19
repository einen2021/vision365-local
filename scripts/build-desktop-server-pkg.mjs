/**
 * Bundle desktop-server + portable Node.js for MSI installs (no Node required on target PC).
 */
import * as esbuild from "esbuild";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { sanitizeDbSeed } from "../src/lib/defaultDbSeed.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const serverResDir = path.join(root, "src-tauri", "resources", "server");
const nodeResDir = path.join(root, "src-tauri", "resources", "node");
const NODE_VERSION = "22.14.0";

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// 1. Bundle server as CommonJS
fs.mkdirSync(serverResDir, { recursive: true });

await esbuild.build({
  entryPoints: [path.join(root, "desktop-server/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: path.join(serverResDir, "index.cjs"),
  format: "cjs",
  external: ["mongodb"],
  sourcemap: false,
});

console.log("[bundle] Built src-tauri/resources/server/index.cjs");

// 2. Ensure portable Node.js
const nodeExe = path.join(nodeResDir, "node.exe");
ensurePortableNode(nodeExe);

// 3. Production node_modules for externalized packages (mongodb + all transitive deps)
const nodeModulesDest = path.join(serverResDir, "node_modules");
if (fs.existsSync(nodeModulesDest)) {
  fs.rmSync(nodeModulesDest, { recursive: true, force: true });
}

const runtimePkgPath = path.join(serverResDir, "package.json");
const rootPkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf-8"));
const mongoVersion =
  rootPkg.dependencies?.mongodb || rootPkg.devDependencies?.mongodb || "^7.3.0";

fs.writeFileSync(
  runtimePkgPath,
  JSON.stringify(
    {
      name: "vision365-server-runtime",
      private: true,
      dependencies: {
        mongodb: mongoVersion,
      },
    },
    null,
    2,
  ),
);

console.log(`[bundle] Installing mongodb ${mongoVersion} for desktop runtime...`);
execSync("npm install --omit=dev --no-package-lock --no-audit --no-fund", {
  cwd: serverResDir,
  stdio: "inherit",
  shell: true,
  env: {
    ...process.env,
    npm_config_update_notifier: "false",
  },
});

// Verify mongodb loads with only the bundled node_modules (no project-root fallback)
execSync(
  `"${nodeExe}" -e "process.chdir('${serverResDir.replace(/\\/g, "/")}'); require('mongodb'); console.log('mongodb runtime ok');"`,
  { stdio: "inherit", shell: true },
);
console.log("[bundle] Verified mongodb runtime dependencies");

// 4. Download bundled mongod for embedded MongoDB
execSync("node scripts/download-mongodb.mjs", { cwd: root, stdio: "inherit", shell: true });

// 5. Copy sanitized seed database for first-run on installed machines

const seedSrc = path.join(root, "data", "db.json");
const seedDest = path.join(root, "src-tauri", "resources", "db-seed.json");
if (fs.existsSync(seedSrc)) {
  const raw = JSON.parse(fs.readFileSync(seedSrc, "utf-8"));
  const clean = sanitizeDbSeed(raw);
  fs.writeFileSync(seedDest, `${JSON.stringify(clean, null, 2)}\n`);
  console.log("[bundle] Wrote sanitized db-seed.json (admin only, empty data)");
}

console.log("[bundle] Desktop server runtime bundle complete");

function ensurePortableNode(nodeExe) {
  const versionFile = path.join(nodeResDir, ".node-version");
  const needsDownload =
    !fs.existsSync(nodeExe) ||
    !fs.existsSync(versionFile) ||
    fs.readFileSync(versionFile, "utf-8").trim() !== NODE_VERSION;

  if (!needsDownload) {
    console.log(`[bundle] node.exe v${NODE_VERSION} already present`);
    return;
  }

  if (fs.existsSync(nodeExe)) fs.unlinkSync(nodeExe);

  fs.mkdirSync(nodeResDir, { recursive: true });
  const zipName = `node-v${NODE_VERSION}-win-x64.zip`;
  const zipUrl = `https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`;
  const zipPath = path.join(nodeResDir, zipName);

  console.log(`[bundle] Downloading Node.js ${NODE_VERSION}...`);
  execSync(`curl -fsSL "${zipUrl}" -o "${zipPath}"`, { stdio: "inherit", shell: true });
  execSync(
    `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${nodeResDir}' -Force"`,
    { stdio: "inherit", shell: true }
  );

  const extracted = path.join(nodeResDir, `node-v${NODE_VERSION}-win-x64`, "node.exe");
  fs.copyFileSync(extracted, nodeExe);
  fs.rmSync(path.join(nodeResDir, `node-v${NODE_VERSION}-win-x64`), { recursive: true, force: true });
  fs.unlinkSync(zipPath);
  fs.writeFileSync(versionFile, NODE_VERSION);
  console.log(`[bundle] Portable node.exe v${NODE_VERSION} ready`);
}
