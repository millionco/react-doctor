import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { extractConfigStringReferencedEntries } from "../src/project-analysis/collect/config-string-entries.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (files: Readonly<Record<string, string>>): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-config-entries-"));
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, "package.json"), "{}");
  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(directory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
  }
  return fs.realpathSync(directory);
};

const relativeEntries = (directory: string): string[] =>
  extractConfigStringReferencedEntries(directory)
    .map((entryPath) => path.relative(directory, entryPath).replaceAll("\\", "/"))
    .sort();

describe("extractConfigStringReferencedEntries", () => {
  it("reads exported config paths without matching comments, imports, or unrelated strings", () => {
    const directory = createProject({
      "webpack.config.ts": `
        import path from "node:path";
        import "./src/import-only";
        const unrelated = "./src/unrelated.ts";
        const config = { entry: path.join("src", "live.ts") };
        // export default { entry: "./src/commented.ts" };
        console.log(unrelated);
        export default config;
      `,
      "src/commented.ts": "export const commented = true;",
      "src/import-only.ts": "export const imported = true;",
      "src/live.ts": "export const live = true;",
      "src/unrelated.ts": "export const unrelated = true;",
    });

    expect(relativeEntries(directory)).toEqual(["src/live.ts"]);
  });

  it("only evaluates path calls through unshadowed node:path bindings", () => {
    const directory = createProject({
      "webpack.config.ts": `
        import path from "node:path";
        const require = (moduleName) => moduleName;
        const createConfig = (path) => ({ entry: path.join("src", "shadowed.ts") });
        require("./src/shadowed-require.ts");
        export default createConfig({ join: (...parts) => parts.join("/") });
      `,
      "src/shadowed-require.ts": "export const shadowedRequire = true;",
      "src/shadowed.ts": "export const shadowed = true;",
    });

    expect(relativeEntries(directory)).toEqual([]);
  });

  it("supports static config callbacks and entry-point properties", () => {
    const directory = createProject({
      "esbuild.config.ts": `
        import { resolve as resolvePath } from "node:path";
        export default () => ({ input: resolvePath(__dirname, "src", "callback.ts") });
      `,
      "src/callback.ts": "export const callback = true;",
    });

    expect(relativeEntries(directory)).toEqual(["src/callback.ts"]);
  });

  it("does not resolve top-level initializers through shadowed callback parameters", () => {
    const directory = createProject({
      "webpack.config.ts": `
        const entry = "./src/decoy.ts";
        export default (entry) => ({ entry });
      `,
      "src/decoy.ts": "export const decoy = true;",
    });

    expect(relativeEntries(directory)).toEqual([]);
  });

  it("collects config entries from conditional return statements", () => {
    const directory = createProject({
      "webpack.config.ts": `
        export default (environment) => {
          if (environment.production) return { entry: "./src/production.ts" };
          return { entry: "./src/development.ts" };
        };
      `,
      "src/development.ts": "export const development = true;",
      "src/production.ts": "export const production = true;",
    });

    expect(relativeEntries(directory)).toEqual(["src/development.ts", "src/production.ts"]);
  });

  it("derives Umi conventions only from the exported config AST", () => {
    const directory = createProject({
      ".umirc.ts": `
        const unrelated = { access: {}, component: "@/unused" };
        // access: {}
        export default {
          routes: [{ component: "@/used" }],
          dynamicImport: { loadingComponent: "./components/loading" },
        };
        console.log(unrelated);
      `,
      "src/access.ts": "export const access = true;",
      "src/components/loading.tsx": "export default () => null;",
      "src/unused.tsx": "export default () => null;",
      "src/used.tsx": "export default () => null;",
    });

    expect(relativeEntries(directory)).toEqual(["src/components/loading.tsx", "src/used.tsx"]);
  });

  it("does not treat metadata nested inside a route as another route", () => {
    const directory = createProject({
      ".umirc.ts": `
        export default {
          routes: [{ component: "@/used", meta: { component: "@/decoy" } }],
        };
      `,
      "src/decoy.tsx": "export default () => null;",
      "src/used.tsx": "export default () => null;",
    });

    expect(relativeEntries(directory)).toEqual(["src/used.tsx"]);
  });
});
