import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      deps: {
        // HACK: oxc-parser loads a platform-specific NAPI binding via
        // require("@oxc-parser/binding-<platform>"). Rollup inlines the
        // JS loader chain but the native lookup then resolves relative to
        // this bundle's dist/ dir, where the binding isn't on the module
        // path — it only lives next to oxc-parser itself. Bundling it
        // therefore crashes the plugin on load with "Cannot find native
        // binding" (same class of bug as react-doctor issue #404). Keep
        // oxc-parser external so its loader runs from its own node_modules
        // tree, where the binding is installed as an optional dependency.
        neverBundle: ["oxc-parser"],
      },
      dts: true,
      target: "node20",
      platform: "node",
      fixedExtension: false,
      env: {
        VERSION: process.env.VERSION ?? packageJson.version,
      },
    },
  ],
  test: {
    testTimeout: 30_000,
  },
});
