import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSync } from "esbuild";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

// Bundle the React-profiler init script into a single self-contained IIFE the
// session injects via `addInitScript`. It must be standalone (no module system)
// because it runs in the page before any app code, and is minified because it
// inlines the React DevTools backend (~1.5MB). Built after pack so the node
// dist never imports this browser-only code — the session loads it by path.
const buildReactProfilerInject = (): void => {
  buildSync({
    entryPoints: [path.join(packageRoot, "src/react-profiler/inject.ts")],
    outfile: path.join(packageRoot, "dist/inject/react-profiler.global.js"),
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    minify: true,
    define: { "process.env.NODE_ENV": '"production"' },
  });
};

export default defineConfig({
  pack: [
    {
      entry: {
        index: "./src/index.ts",
      },
      deps: {
        // playwright-core is large and resolves its own browser channel at
        // runtime; keep it external so the dist stays a thin wrapper.
        neverBundle: ["playwright-core"],
      },
      dts: true,
      target: "es2022",
      platform: "node",
      fixedExtension: false,
      hooks: {
        "build:done": () => {
          buildReactProfilerInject();
        },
      },
    },
  ],
  test: {
    testTimeout: 10_000,
  },
});
