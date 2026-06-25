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
      // The engine moved into `@react-doctor/core/deslop`; build the worker
      // entry straight from core's source so this package still emits a
      // sibling `dist/parse-worker.mjs` for the bundled parallel parser to
      // resolve via `import.meta.url`.
      entry: ["../core/src/deslop/collect/parse-worker.ts"],
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
