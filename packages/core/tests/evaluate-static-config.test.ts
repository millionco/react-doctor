import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { evaluateStaticConfig } from "../src/project-analysis/utils/evaluate-static-config.js";

const CONFIG_PATH = "/workspace/vite.config.ts";

describe("evaluateStaticConfig helper provenance", () => {
  it("evaluates approved ESM helper aliases and globals", () => {
    const config = evaluateStaticConfig(
      `
        import { defineConfig as configure } from "vite";
        import pathHelpers, { join as joinPath } from "node:path";
        import { fileURLToPath as fromFileUrl } from "node:url";
        export default configure(Object.freeze({
          root: pathHelpers.resolve(__dirname, "app"),
          input: joinPath(__dirname, "src", "index.ts"),
          currentFile: fromFileUrl(new URL("./vite.config.ts", import.meta.url)),
        }));
      `,
      CONFIG_PATH,
    );

    expect(config).toEqual({
      root: path.resolve("/workspace", "app"),
      input: path.resolve("/workspace", "src", "index.ts"),
      currentFile: path.resolve("/workspace", "vite.config.ts"),
    });
  });

  it("evaluates approved namespace and CommonJS helpers", () => {
    expect(
      evaluateStaticConfig(
        `
          import * as vite from "vite";
          import * as pathHelpers from "path";
          export default vite.defineConfig({ root: pathHelpers.join(__dirname, "app") });
        `,
        CONFIG_PATH,
      ),
    ).toEqual({ root: path.resolve("/workspace", "app") });

    expect(
      evaluateStaticConfig(
        `
          const { defineConfig: configure } = require("tsup");
          const { resolve: resolvePath } = require("node:path");
          module.exports = configure({ entry: resolvePath(__dirname, "src/index.ts") });
        `,
        CONFIG_PATH,
      ),
    ).toEqual({ entry: path.resolve("/workspace", "src/index.ts") });
  });

  it.each([
    [
      "a local config wrapper",
      `const defineConfig = (value) => ({ root: "wrong" }); export default defineConfig({ root: "app" });`,
    ],
    [
      "a relative config-wrapper import",
      `import { defineConfig } from "./helpers"; export default defineConfig({ root: "app" });`,
    ],
    [
      "an unrelated config-wrapper import",
      `import { defineConfig } from "config-transformer"; export default defineConfig({ root: "app" });`,
    ],
    [
      "a local freeze function",
      `const freeze = (value) => value; export default freeze({ root: "app" });`,
    ],
    [
      "an imported freeze function",
      `import { freeze } from "object-tools"; export default freeze({ root: "app" });`,
    ],
    [
      "a shadowed Object global",
      `const Object = { freeze: (value) => value }; export default Object.freeze({ root: "app" });`,
    ],
  ])("does not evaluate %s", (_, content) => {
    expect(evaluateStaticConfig(content, CONFIG_PATH)).toBeUndefined();
  });

  it.each([
    [
      "a local path function",
      `const resolve = () => "/wrong"; export default { safe: true, root: resolve(__dirname, "app") };`,
    ],
    [
      "a relative path-function import",
      `import { resolve } from "./helpers"; export default { safe: true, root: resolve(__dirname, "app") };`,
    ],
    [
      "an unrelated path namespace",
      `import pathHelpers from "./helpers"; export default { safe: true, root: pathHelpers.resolve(__dirname, "app") };`,
    ],
    [
      "a local path namespace",
      `const path = { resolve: () => "/wrong" }; export default { safe: true, root: path.resolve(__dirname, "app") };`,
    ],
    [
      "a callback parameter shadowing an approved import",
      `
        import { defineConfig } from "vite";
        import { resolve } from "node:path";
        export default defineConfig((resolve) => ({ safe: true, root: resolve(__dirname, "app") }));
      `,
    ],
    [
      "a callback-local binding shadowing an approved import",
      `
        import { defineConfig } from "vite";
        import path from "node:path";
        export default defineConfig(() => {
          const path = { resolve: () => "/wrong" };
          return { safe: true, root: path.resolve(__dirname, "app") };
        });
      `,
    ],
    [
      "a shadowed URL global",
      `
        import { fileURLToPath } from "node:url";
        const URL = class {};
        export default { safe: true, file: fileURLToPath(new URL("./app", import.meta.url)) };
      `,
    ],
  ])("omits calls through %s", (_, content) => {
    expect(evaluateStaticConfig(content, CONFIG_PATH)).toEqual({ safe: true });
  });
});
