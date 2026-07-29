import { defineConfig } from "vite-plus";
import {
  DEFAULT_TEST_TIMEOUT_MS,
  ENGINE_RUNTIME_EXTERNALS,
  NODE_PACK_TARGET,
} from "../../scripts/build/constants.js";

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      deps: {
        neverBundle: ENGINE_RUNTIME_EXTERNALS,
      },
      dts: true,
      target: NODE_PACK_TARGET,
      platform: "node",
      fixedExtension: false,
    },
  ],
  test: {
    testTimeout: DEFAULT_TEST_TIMEOUT_MS,
  },
});
