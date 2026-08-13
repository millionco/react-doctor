import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";
import { parseSourceFile } from "../src/project-analysis/collect/parse.js";
import { extractRuntimeConsumedDirectoryFiles } from "../src/project-analysis/collect/runtime-consumed-directory-files.js";
import { MAX_PARSE_FILE_SIZE_BYTES } from "../src/project-analysis/constants.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
  packageJson: Readonly<Record<string, unknown>> = {},
): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-oxc-parsers-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const relativeUnusedPaths = (
  rootDirectory: string,
  unusedFiles: ReadonlyArray<{ readonly path: string }>,
): string[] =>
  unusedFiles.map((unusedFile) =>
    path.relative(rootDirectory, unusedFile.path).replaceAll("\\", "/"),
  );

describe("Oxc-backed project configuration discovery", () => {
  it("recognizes imported test APIs without trusting shadowed lookalikes", () => {
    const rootDirectory = createProject({
      "src/mocks.ts": `
        import { vi as vitestApi } from "vitest";
        import { jest as jestApi } from "@jest/globals";
        vitestApi.mock("./from-vitest", () => ({}));
        jestApi.mock("./from-jest", () => ({}));
        {
          const vitestApi = { mock: () => undefined };
          vitestApi.mock("./shadowed-vitest", () => ({}));
        }
        const vi = { mock: () => undefined };
        const jest = { mock: () => undefined };
        vi.mock("./local-vi", () => ({}));
        jest.mock("./local-jest", () => ({}));
      `,
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/mocks.ts"));
    const relativeDynamicSpecifiers = parsedSource.imports
      .filter((importReference) => importReference.isDynamic)
      .map((importReference) => importReference.specifier);

    expect(relativeDynamicSpecifiers).toEqual(["./from-vitest", "./from-jest"]);
  });

  it("hoists var bindings only to their containing function or program", () => {
    const rootDirectory = createProject({
      "src/function-scope.cjs": `
        require("./global-runtime");
        function loadLocally() {
          require("./shadowed-before-declaration");
          if (false) var require = localLoader;
        }
        console.log(loadLocally);
      `,
      "src/program-scope.cjs": `
        require("./shadowed-at-program-scope");
        if (false) var require = localLoader;
      `,
    });

    const functionScopeSource = parseSourceFile(path.join(rootDirectory, "src/function-scope.cjs"));
    const programScopeSource = parseSourceFile(path.join(rootDirectory, "src/program-scope.cjs"));

    expect(
      functionScopeSource.imports
        .filter((importReference) => importReference.isDynamic)
        .map((importReference) => importReference.specifier),
    ).toEqual(["./global-runtime"]);
    expect(programScopeSource.imports).toEqual([]);
  });

  it("discovers statically bound directories read through fs.promises", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `
        import fs from "node:fs";
        import path from "node:path";
        const projectRoot = process.cwd();
        const featureDirectoryName = "features";
        const featureDirectory = path.join(projectRoot, "src", featureDirectoryName);
        fs.promises.readdir(featureDirectory);
        const filesystem = require("node:fs");
        const filePaths = require("node:path");
        const commonJsDirectory = filePaths.resolve(projectRoot, "src", "commonjs");
        filesystem.readdirSync(commonJsDirectory);
        const dormantDirectory = path.join(projectRoot, "src", "dormant");
        database.readdir(dormantDirectory);
        const commentedDirectory = path.join(projectRoot, "src", "commented");
        // fs.readdirSync(commentedDirectory);
        console.log("fs.readdirSync(commentedDirectory)");
        {
          const featureDirectory = path.join(projectRoot, "src", "shadowed");
          const fs = { promises: { readdir: () => [] } };
          fs.promises.readdir(featureDirectory);
        }
      `,
      "src/features/runtime.ts": "export const runtime = true;",
      "src/commonjs/runtime.ts": "export const commonJsRuntime = true;",
      "src/dormant/runtime.ts": "export const dormant = true;",
      "src/commented/runtime.ts": "export const commented = true;",
      "src/shadowed/runtime.ts": "export const shadowed = true;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/commented/runtime.ts",
      "src/dormant/runtime.ts",
      "src/shadowed/runtime.ts",
    ]);
  });

  it("ignores files passed to directory-copy APIs", async () => {
    const rootDirectory = createProject({
      "rollup.config.mjs": `
        import fs from "fs-extra";
        fs.copySync("./README.md", "./dist/README.md");
        fs.copySync("./index.html", "./dist/index.html");
        fs.copySync("./templates", "./dist/templates");
      `,
      "README.md": "# Example",
      "index.html": "<main>Example</main>",
      "templates/runtime.ts": "export const runtime = true;",
      "src/index.ts": "export const entry = true;",
      "src/orphan.ts": "export const orphan = true;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.analysisErrors).toEqual([]);
    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("skips runtime directory discovery in oversized source files", () => {
    const rootDirectory = createProject({
      "src/oversized-runtime.js": `
        fs.readdirSync(path.join(process.cwd(), "src", "runtime"));
        /* ${"x".repeat(MAX_PARSE_FILE_SIZE_BYTES)} */
      `,
      "src/runtime/discovered.ts": "export const discovered = true;",
    });

    expect(extractRuntimeConsumedDirectoryFiles(rootDirectory)).toEqual([]);
  });

  it("scans large scopes without copying bindings for every AST node", () => {
    const largeScopeBindingCount = 20_000;
    const largeScopeBindings = Array.from(
      { length: largeScopeBindingCount },
      (_, bindingIndex) => `const binding${bindingIndex} = ${bindingIndex};`,
    ).join("\n");
    const rootDirectory = createProject({
      "src/runtime-loader.js": `
        ${largeScopeBindings}
        fs.readdirSync(path.join(process.cwd(), "src", "runtime"));
      `,
      "src/runtime/discovered.ts": "export const discovered = true;",
    });

    expect(
      extractRuntimeConsumedDirectoryFiles(rootDirectory).map((filePath) =>
        path.relative(rootDirectory, filePath).replaceAll("\\", "/"),
      ),
    ).toEqual(["src/runtime/discovered.ts"]);
  });

  it("resolves React Router appDirectory through static shorthand bindings", async () => {
    const rootDirectory = createProject(
      {
        "react-router.config.ts": `
          const appDirectory = "application";
          const config = { appDirectory };
          export default config;
        `,
        "application/root.tsx": "export default () => null;",
        "application/routes/home.tsx": "export default () => null;",
        "src/orphan.ts": "export const orphan = true;",
      },
      { dependencies: { "@react-router/dev": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    const unusedFilePaths = relativeUnusedPaths(rootDirectory, result.unusedFiles);
    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["application/root.tsx", "application/routes/home.tsx"]),
    );
  });

  it("preserves sibling workspace subpaths loaded through require.resolve", async () => {
    const monorepoDirectory = createProject(
      {
        "packages/library/package.json": JSON.stringify({ name: "@example/library" }),
        "packages/library/src/index.ts": "export const root = true;",
        "packages/library/src/runtime/plugin.ts": "export const plugin = true;",
        "packages/library/src/runtime/commented.ts": "export const commented = true;",
        "packages/library/src/runtime/shadowed.ts": "export const shadowed = true;",
        "packages/app/package.json": JSON.stringify({ name: "@example/app" }),
        "packages/app/src/index.ts": `
          const pluginPath = require.resolve("@example/library/src/runtime/plugin");
          const loadWithShadow = () => {
            const require = { resolve: (specifier) => specifier };
            require.resolve("@example/library/src/runtime/shadowed");
          };
          // require.resolve("@example/library/src/runtime/commented");
          console.log(pluginPath, loadWithShadow);
        `,
      },
      { private: true, workspaces: ["packages/*"] },
    );
    const libraryDirectory = path.join(monorepoDirectory, "packages/library");

    const result = await analyzeProject({
      rootDirectory: libraryDirectory,
      entryPatterns: ["src/index.ts"],
    });

    expect(relativeUnusedPaths(libraryDirectory, result.unusedFiles)).toEqual([
      "src/runtime/commented.ts",
      "src/runtime/shadowed.ts",
    ]);
  });

  it("resolves Jest moduleNameMapper aliases through static shorthand bindings", async () => {
    const rootDirectory = createProject({
      "jest.config.ts": `
        const moduleNameMapper = { "^@library/(.*)$": "<rootDir>/src/library/$1" };
        const config = { moduleNameMapper };
        export default config;
      `,
      "src/index.ts": `import { value } from "@library/value"; console.log(value);`,
      "src/library/value.ts": "export const value = true; export const unused = false;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).not.toContain(
      "src/library/value.ts",
    );
    expect(result.unusedExports.map((unusedExport) => unusedExport.name)).toEqual(["unused"]);
  });
});

describe("embedded component source positions", () => {
  it("finds top-level scripts after self-closing custom elements", () => {
    const rootDirectory = createProject({
      "src/card.vue": [
        "<CustomElement />",
        "<Container>",
        "  <script>import Nested from './nested';</script>",
        "</Container>",
        "<script>",
        'import Actual from "./actual";',
        "export const stale = true;",
        "</script>",
      ].join("\n"),
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/card.vue"));

    expect(parsedSource.imports).toEqual([
      expect.objectContaining({ specifier: "./actual", line: 6, column: 0 }),
    ]);
    expect(parsedSource.exports).toEqual([
      expect.objectContaining({ name: "stale", line: 7, column: 13 }),
    ]);
  });

  it("preserves Astro frontmatter and later script positions", () => {
    const rootDirectory = createProject({
      "src/card.astro": [
        "---",
        'import Frontmatter from "./frontmatter";',
        "export interface Props { title: string }",
        "export const staleFrontmatter = true;",
        "---",
        "<main>😀</main>",
        '<script src="./client.js" />',
        "<script>",
        'import Later from "./later";',
        "export const staleLater = true;",
        "</script>",
      ].join("\r\n"),
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/card.astro"));

    expect(parsedSource.imports).toEqual([
      expect.objectContaining({ specifier: "./frontmatter", line: 2, column: 0 }),
      expect.objectContaining({ specifier: "./client.js", line: 7, column: 0 }),
      expect.objectContaining({ specifier: "./later", line: 9, column: 0 }),
    ]);
    expect(parsedSource.exports).toEqual([
      expect.objectContaining({ name: "staleFrontmatter", line: 4, column: 13 }),
      expect.objectContaining({ name: "staleLater", line: 10, column: 13 }),
    ]);
  });

  it("uses Astro syntax nodes for frontmatter and script extraction", () => {
    const rootDirectory = createProject({
      "src/card.astro": [
        "---",
        'import Frontmatter from "./frontmatter";',
        'const description = "export interface Props { ignored: true }";',
        "export interface Props { title: string }",
        "---",
        '<!-- <script src="./commented.js" /> -->',
        '<script data-note=">">',
        'import Actual from "./actual";',
        "export const stale = true;",
        "</script>",
      ].join("\n"),
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/card.astro"));

    expect(parsedSource.imports).toEqual([
      expect.objectContaining({ specifier: "./frontmatter", line: 2, column: 0 }),
      expect.objectContaining({ specifier: "./actual", line: 8, column: 0 }),
    ]);
    expect(parsedSource.exports).toEqual([
      expect.objectContaining({ name: "stale", line: 9, column: 13 }),
    ]);
  });

  it("follows Astro compiler semantics for frontmatter delimiter suffixes", () => {
    const rootDirectory = createProject({
      "src/card.astro": [
        "---",
        'import BeforeSuffix from "./before-suffix";',
        "---suffix",
        'import AfterSuffix from "./after-suffix";',
        "---",
      ].join("\n"),
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/card.astro"));

    expect(parsedSource.imports).toEqual([
      expect.objectContaining({ specifier: "./before-suffix", line: 2, column: 0 }),
    ]);
  });

  it("preserves positions across multiple Vue script blocks", () => {
    const rootDirectory = createProject({
      "src/card.vue": [
        "<template>",
        "  <main>😀</main>",
        "</template>",
        "<script>",
        'import First from "./first";',
        "</script>",
        "<style>main { display: block }</style>",
        '<script lang="ts">',
        'import Second from "./second";',
        "export const stale = true;",
        "</script>",
      ].join("\n"),
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/card.vue"));

    expect(parsedSource.imports).toEqual([
      expect.objectContaining({ specifier: "./first", line: 5, column: 0 }),
      expect.objectContaining({ specifier: "./second", line: 9, column: 0 }),
    ]);
    expect(parsedSource.exports).toEqual([
      expect.objectContaining({ name: "stale", line: 10, column: 13 }),
    ]);
  });

  it("ignores commented Vue scripts and quoted greater-than attributes", () => {
    const rootDirectory = createProject({
      "src/card.vue": [
        '<!-- <script>import Commented from "./commented";</script> -->',
        "<template>",
        '  <!-- <script>import NestedComment from "./nested-comment";</script> -->',
        "</template>",
        '<script lang="ts" data-note=">">',
        'import Actual from "./actual";',
        "export const stale = true;",
        "</script>",
      ].join("\n"),
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/card.vue"));

    expect(parsedSource.imports).toEqual([
      expect.objectContaining({ specifier: "./actual", line: 6, column: 0 }),
    ]);
    expect(parsedSource.exports).toEqual([
      expect.objectContaining({ name: "stale", line: 7, column: 13 }),
    ]);
  });

  it("preserves Svelte module and instance script positions", () => {
    const rootDirectory = createProject({
      "src/card.svelte": [
        "<main>😀</main>",
        '<script context="module">',
        "export const staleModule = true;",
        "</script>",
        "<div>content</div>",
        '<script lang="ts">',
        "export let title: string;",
        "export const staleInstance = true;",
        "</script>",
      ].join("\n"),
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/card.svelte"));

    expect(parsedSource.exports).toEqual([
      expect.objectContaining({ name: "staleModule", line: 3, column: 13 }),
      expect.objectContaining({ name: "staleInstance", line: 8, column: 13 }),
    ]);
  });

  it("recognizes only real Svelte module attributes", () => {
    const rootDirectory = createProject({
      "src/card.svelte": [
        "<!-- <script module>export const commented = true;</script> -->",
        '<script data-note=\'context="module"\' data-symbol=">">',
        "export let instanceProp: string;",
        "export const staleInstance = true;",
        "</script>",
        '<script module data-symbol=">">',
        "export let moduleValue: string;",
        "</script>",
      ].join("\n"),
    });

    const parsedSource = parseSourceFile(path.join(rootDirectory, "src/card.svelte"));

    expect(parsedSource.exports).toEqual([
      expect.objectContaining({ name: "staleInstance", line: 4, column: 13 }),
      expect.objectContaining({ name: "moduleValue", line: 7, column: 11 }),
    ]);
  });
});
