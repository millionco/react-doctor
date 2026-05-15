import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      deps: { neverBundle: ["oxlint", "oxlint-plugin-react-doctor", "typescript"] },
      dts: true,
      target: "node22",
      platform: "node",
      fixedExtension: false,
    },
  ],
});
