import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts", worker: "./src/runner/worker.ts" },
      deps: {
        neverBundle: ["oxc-parser", "oxlint-plugin-react-doctor"],
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
