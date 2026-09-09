import { defineConfig } from "vite-plus";
import { requireTypescriptPlugin } from "../../scripts/require-typescript-plugin.js";

export default defineConfig({
  pack: [
    {
      entry: {
        index: "./src/index.ts",
        "project-analysis-worker": "./src/project-analysis-worker.ts",
        "oxlint-worker": "./src/oxlint-worker.ts",
        "duplicate-jsx-worker": "./src/duplicate-jsx-worker.ts",
      },
      deps: {
        alwaysBundle: ["typescript"],
        neverBundle: [
          "effect",
          "oxc-parser",
          "oxc-resolver",
          "oxlint",
          "oxlint-plugin-react-doctor",
        ],
      },
      plugins: [requireTypescriptPlugin()],
      dts: true,
      target: "node20",
      platform: "node",
      fixedExtension: false,
    },
  ],
  test: {
    testTimeout: 30_000,
  },
});
