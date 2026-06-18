import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["src/main.ts"],
    format: "cjs",
    outDir: "dist",
  },
  {
    entry: ["src/preload.ts"],
    format: "cjs",
    outDir: "dist",
  },
]);
