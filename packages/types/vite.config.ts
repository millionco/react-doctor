import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      dts: true,
      target: "node22",
      platform: "node",
      fixedExtension: false,
    },
  ],
});
