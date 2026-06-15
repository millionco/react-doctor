import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: {
        index: "./src/index.ts",
        harness: "./src/harness.ts",
        "index.native": "./src/index.native.ts",
        "harness.native": "./src/harness.native.ts",
      },
      deps: {
        // The harness runs inside the host app, which already ships React.
        // Keep React and the (heavy) DevTools bundle external so the harness
        // dist stays small and shares the app's single React instance. The web
        // entries import `react-devtools-inline/frontend`; the native entries
        // import only `react-devtools-inline/backend` (no react-dom/fs).
        neverBundle: ["react", "react-dom", "react-devtools-inline"],
      },
      dts: true,
      target: "es2022",
      platform: "browser",
      fixedExtension: false,
    },
  ],
  test: {
    testTimeout: 10_000,
  },
});
