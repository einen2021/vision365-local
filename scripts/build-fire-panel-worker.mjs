/**
 * Compile firePanelWorker.ts → plain CommonJS so worker_threads
 * never need the ".ts" loader (fixes "Unknown file extension .ts" on other PCs).
 */
import * as esbuild from "esbuild";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const entry = path.join(root, "desktop-server", "src", "workers", "firePanelWorker.ts");
const outfile = path.join(
  root,
  "desktop-server",
  "src",
  "workers",
  "firePanelWorker.runtime.cjs",
);

if (!fs.existsSync(entry)) {
  console.error(`[fire-panel-worker] Missing source: ${entry}`);
  process.exit(1);
}

await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  logLevel: "warning",
});

console.log(`[fire-panel-worker] Built ${outfile}`);
