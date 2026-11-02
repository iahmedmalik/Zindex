import { defineConfig } from "tsup";

// Bundles the app into one file that Vercel runs as its function (api/api/index.js). The source imports have
// no file extensions, which Node cannot load file by file; bundling resolves them, as the Render build does.
export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "api",
  format: ["esm"],
  target: "node22",
  platform: "node",
});
