import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import {
  DEFAULT_TEST_TIMEOUT_MS,
  ENGINE_RUNTIME_EXTERNALS,
  NODE_PACK_TARGET,
} from "../../scripts/build/constants.js";
import { readPackageVersion } from "../../scripts/utils/read-package-version.js";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const packageVersion = readPackageVersion(import.meta.url);

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts", schemas: "./src/schemas.ts" },
      deps: {
        neverBundle: ["@effect/platform-node-shared", ...ENGINE_RUNTIME_EXTERNALS],
      },
      dts: true,
      target: NODE_PACK_TARGET,
      platform: "node",
      fixedExtension: false,
      env: {
        REACT_DOCTOR_CORE_VERSION: packageVersion,
      },
    },
  ],
  test: {
    alias: [
      {
        find: /^@react-doctor\/core$/,
        replacement: path.join(packageRoot, "src/index.ts"),
      },
      {
        find: /^@react-doctor\/core\/schemas$/,
        replacement: path.join(packageRoot, "src/schemas.ts"),
      },
      {
        find: /^oxlint-plugin-react-doctor$/,
        replacement: path.join(packageRoot, "../oxlint-plugin-react-doctor/src/index.ts"),
      },
    ],
    testTimeout: DEFAULT_TEST_TIMEOUT_MS,
  },
});
