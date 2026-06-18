import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: ["./src/index.ts"],
      format: ["cjs", "esm"],
      dts: true,
      clean: true,
      platform: "node",
      sourcemap: false,
      minify: process.env.NODE_ENV === "production",
    },
    {
      entry: ["./src/collect/parse-worker.ts"],
      format: ["esm"],
      dts: false,
      clean: false,
      platform: "node",
      sourcemap: false,
      minify: process.env.NODE_ENV === "production",
    },
  ],
  test: {
    include: ["tests/**/*.test.ts"],
  },
});
