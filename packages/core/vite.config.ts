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
      entry: { index: "./src/index.ts", schemas: "./src/schemas.ts" },
      deps: {
        neverBundle: [
          "@effect/platform-node-shared",
          "deslop-js",
          "effect",
          "oxc-parser",
          "oxc-resolver",
          "oxlint",
          "oxlint-plugin-react-doctor",
          "typescript",
        ],
      },
      dts: true,
      target: "node20",
      platform: "node",
      fixedExtension: false,
      env: {
        REACT_DOCTOR_CORE_VERSION: packageJson.version,
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
    testTimeout: 30_000,
  },
});
