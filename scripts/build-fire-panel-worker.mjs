import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const workerSrc = path.join(root, "desktop-server/src/workers/firePanelWorker.ts");
const outFile = path.join(root, "desktop-server/src/workers/firePanelWorker.runtime.cjs");

await esbuild.build({
  entryPoints: [workerSrc],
  outfile: outFile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  packages: "external",
  sourcemap: false,
  logLevel: "info",
});

console.log("[build-fire-panel-worker] Built", outFile);
