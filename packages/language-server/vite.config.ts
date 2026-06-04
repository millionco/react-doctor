import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  pack: [
    {
      entry: { index: "./src/index.ts" },
      env: {
        VERSION: process.env.VERSION ?? version,
      },
      deps: {
        // Keep the heavy engine + LSP transport external so the
        // language-server dist stays lean and runnable standalone via
        // its own node_modules. The react-doctor CLI re-bundles this
        // dist and decides which of these to inline at publish time.
        neverBundle: [
          "@react-doctor/core",
          "deslop-js",
          "effect",
          "oxc-parser",
          "oxc-resolver",
          "oxlint",
          "oxlint-plugin-react-doctor",
          "typescript",
          "vscode-languageserver",
          "vscode-languageserver-protocol",
          "vscode-languageserver-textdocument",
          "vscode-jsonrpc",
          "vscode-uri",
        ],
      },
      dts: true,
      target: "node20",
      platform: "node",
      fixedExtension: false,
    },
  ],
  test: {
    testTimeout: 30_000,
  },
});
