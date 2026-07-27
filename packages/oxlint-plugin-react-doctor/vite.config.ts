import { defineConfig } from "vite-plus";
import { DEFAULT_TEST_TIMEOUT_MS, NODE_PACK_TARGET } from "../../scripts/build/constants.js";
import { readPackageVersion } from "../../scripts/utils/read-package-version.js";

const packageVersion = readPackageVersion(import.meta.url);

export default defineConfig({
  pack: [
    {
      entry: {
        contracts: "./src/contracts.ts",
        index: "./src/index.ts",
      },
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
      target: NODE_PACK_TARGET,
      platform: "node",
      fixedExtension: false,
      env: {
        VERSION: process.env.VERSION ?? packageVersion,
      },
    },
  ],
  test: {
    testTimeout: DEFAULT_TEST_TIMEOUT_MS,
  },
});
