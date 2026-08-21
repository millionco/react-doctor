import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: {
        index: "./src/index.ts",
        "project-analysis-worker": "./src/project-analysis-worker.ts",
      },
      deps: {
        neverBundle: [
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
    },
  ],
  test: {
    testTimeout: 30_000,
  },
});
