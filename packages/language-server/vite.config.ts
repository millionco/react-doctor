import { defineConfig } from "vite-plus";
import {
  DEFAULT_TEST_TIMEOUT_MS,
  ENGINE_RUNTIME_EXTERNALS,
  LSP_RUNTIME_EXTERNALS,
  NODE_PACK_TARGET,
} from "../../scripts/build/constants.js";
import { readPackageVersion } from "../../scripts/utils/read-package-version.js";

const packageVersion = readPackageVersion(import.meta.url);

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      env: {
        VERSION: process.env.VERSION ?? packageVersion,
      },
      deps: {
        // Keep the heavy engine + LSP transport external so the
        // language-server dist stays lean and runnable standalone via
        // its own node_modules. The react-doctor CLI re-bundles this
        // dist and decides which of these to inline at publish time.
        neverBundle: ["@react-doctor/core", ...ENGINE_RUNTIME_EXTERNALS, ...LSP_RUNTIME_EXTERNALS],
      },
      dts: true,
      target: NODE_PACK_TARGET,
      platform: "node",
      fixedExtension: false,
    },
  ],
  test: {
    testTimeout: DEFAULT_TEST_TIMEOUT_MS,
    // The integration suite boots a real LSP server subprocess and waits up
    // to 20s for it to publish diagnostics inside `beforeAll`. The default
    // 10s hook timeout is shorter than that wait, so a slow cold start on
    // macOS / Windows CI runners trips the hook before the server is ready.
    // Match it to `testTimeout` so the hook gets the same budget as the tests.
    hookTimeout: DEFAULT_TEST_TIMEOUT_MS,
  },
});
