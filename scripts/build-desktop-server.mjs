import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

await esbuild.build({
  entryPoints: [path.join(root, "desktop-server/src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: path.join(root, "desktop-server/dist/index.js"),
  format: "esm",
  packages: "external",
  sourcemap: true,
});

console.log("[build-desktop-server] Built desktop-server/dist/index.js");
