import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

await esbuild.build({
  entryPoints: {
    index: path.join(root, "desktop-server/src/index.ts"),
    firePanelWorker: path.join(root, "desktop-server/src/workers/firePanelWorker.ts"),
  },
  bundle: true,
  platform: "node",
  target: "node20",
  outdir: path.join(root, "desktop-server/dist"),
  entryNames: "[name]",
  format: "esm",
  packages: "external",
  sourcemap: true,
});

console.log("[build-desktop-server] Built desktop-server/dist/");
