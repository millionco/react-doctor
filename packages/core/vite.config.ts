import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: {
        index: "./src/index.ts",
        schemas: "./src/schemas.ts",
        deslop: "./src/deslop/index.ts",
      },
      deps: {
        neverBundle: [
          "@effect/platform-node-shared",
          "@oxc-project/types",
          "effect",
          "fast-glob",
          "minimatch",
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
    {
      // Emitted as a standalone `dist/parse-worker.mjs` so the deslop parallel
      // parser (bundled into `dist/deslop.js`) can spawn it via
      // `new URL("./parse-worker.mjs", import.meta.url)`.
      entry: ["./src/deslop/collect/parse-worker.ts"],
      format: ["esm"],
      deps: {
        neverBundle: ["@oxc-project/types", "fast-glob", "minimatch", "oxc-parser", "oxc-resolver"],
      },
      dts: false,
      clean: false,
      target: "node20",
      platform: "node",
    },
  ],
  test: {
    testTimeout: 30_000,
    include: ["tests/**/*.test.ts"],
    // The deslop engine's tests scan fixture projects that deliberately
    // contain their own `*.test.ts` / `*.spec.ts` files (test data for the
    // dead-code analyzer); never collect those as real tests.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/fixtures/**",
      // deslop's analyze() returns OS-native path separators; production
      // normalizes them to POSIX in check-dead-code's toRelativeFilePath, but
      // these integration tests assert POSIX paths against the raw engine
      // output. They're POSIX-only (the same reason check-dead-code.test.ts
      // skips its import-graph cases on win32), and never ran on Windows under
      // deslop-js's `node --test tests/*.test.ts` glob.
      ...(process.platform === "win32" ? ["tests/deslop/analyze.test.ts"] : []),
    ],
  },
});
