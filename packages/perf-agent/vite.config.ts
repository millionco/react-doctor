import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts", harness: "./src/harness.ts" },
      deps: {
        // The harness runs inside the host app, which already ships React.
        // Keep React and the (heavy) DevTools bundle external so the harness
        // dist stays small and shares the app's single React instance.
        neverBundle: ["react", "react-dom", "react-devtools-inline"],
      },
      dts: true,
      target: "es2022",
      platform: "browser",
      fixedExtension: false,
    },
  ],
});
