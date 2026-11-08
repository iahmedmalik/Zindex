import { defineConfig } from "tsup";

// Bundles the app into one file (dist-vercel/index.js). Vercel finds its function by looking at the committed
// api/api/index.js BEFORE the build runs, so that small file is the function and it loads this bundle. The source imports have
// no file extensions, which Node cannot load file by file; bundling resolves them, as the Render build does.
export default defineConfig({
  entry: { index: "src/index.ts" },
  outDir: "dist-vercel",
  format: ["esm"],
  target: "node22",
  platform: "node",
});
