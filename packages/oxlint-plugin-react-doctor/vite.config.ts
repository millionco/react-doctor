import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  pack: [
    {
      entry: { core: "./src/core.ts", index: "./src/index.ts" },
      deps: {
        // HACK: lightningcss and oxc-parser load platform-specific native
        // bindings relative to their own packages. Bundling their loaders
        // moves that lookup into dist, where the optional bindings are not
        // available (the same failure mode as react-doctor issue #404).
        neverBundle: ["lightningcss", "oxc-parser"],
      },
      dts: true,
      target: "node20",
      platform: "node",
      minify: process.env.NODE_ENV === "production",
      fixedExtension: false,
      env: {
        VERSION: process.env.VERSION ?? packageJson.version,
      },
    },
  ],
  test: {
    testTimeout: 30_000,
  },
});
