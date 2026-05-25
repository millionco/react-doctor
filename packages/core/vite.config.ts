import { defineConfig } from "vite-plus";

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
    },
  ],
  test: {
    testTimeout: 30_000,
  },
});
