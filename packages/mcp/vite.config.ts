import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: {
        index: "./src/index.ts",
      },
      dts: true,
      target: "es2022",
      platform: "node",
      fixedExtension: false,
    },
  ],
  test: {
    testTimeout: 10_000,
  },
});
