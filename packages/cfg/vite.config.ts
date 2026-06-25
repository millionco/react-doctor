import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      deps: {
        neverBundle: ["@typescript-eslint/types"],
      },
      dts: true,
      target: "node20",
      platform: "node",
      fixedExtension: false,
    },
  ],
});
