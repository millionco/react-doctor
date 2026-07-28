import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      deps: {
        neverBundle: ["@babel/core", "babel-plugin-react-compiler", "typescript"],
      },
      dts: true,
      target: "node22",
      platform: "node",
      fixedExtension: false,
    },
  ],
  test: {
    alias: [
      {
        find: /^@react-doctor\/prover$/,
        replacement: path.join(packageRoot, "src/index.ts"),
      },
    ],
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
