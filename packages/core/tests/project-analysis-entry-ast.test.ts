import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";

const temporaryDirectories: string[] = [];

const createProject = (files: Readonly<Record<string, string>>, packageJson: object): string => {
  const rootDirectory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-entry-ast-")),
  );
  temporaryDirectories.push(rootDirectory);
  for (const [relativePath, sourceText] of Object.entries({
    "package.json": JSON.stringify({ name: "entry-ast", ...packageJson }),
    ...files,
  })) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, sourceText);
  }
  return rootDirectory;
};

const getUnusedPaths = (
  rootDirectory: string,
  unusedFiles: ReadonlyArray<{ readonly path: string }>,
): string[] =>
  unusedFiles.map((unusedFile) =>
    path.relative(rootDirectory, unusedFile.path).replaceAll("\\", "/"),
  );

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("project entry syntax analysis", () => {
  it("collects only unshadowed extensionless script requires", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const application = true;",
        "script/task": [
          "#!/usr/bin/env node",
          'require("./active");',
          'const text = `require("./string-decoy")`;',
          '// require("./comment-decoy");',
          '((require) => require("./shadowed"))(() => undefined);',
        ].join("\n"),
        "script/shadowed-task": [
          "#!/usr/bin/env node",
          "const require = (specifier) => specifier;",
          'require("./top-level-shadowed");',
        ].join("\n"),
        "script/active.js": "module.exports = true;",
        "script/string-decoy.js": "module.exports = true;",
        "script/comment-decoy.js": "module.exports = true;",
        "script/shadowed.js": "module.exports = true;",
        "script/top-level-shadowed.js": "module.exports = true;",
      },
      { scripts: { build: "script/task build", prepare: "script/shadowed-task" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(getUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "script/comment-decoy.js",
      "script/shadowed.js",
      "script/string-decoy.js",
      "script/top-level-shadowed.js",
    ]);
  });

  it("collects exported Webpack entries without string, comment, or shadowing decoys", async () => {
    const rootDirectory = createProject(
      {
        "webpack.config.js": [
          'import "./webpack-shadowed";',
          'const path = require("node:path");',
          'const directEntries = ["./src/direct", require.resolve("./src/resolved")];',
          "const config = {",
          "  entry: {",
          "    application: directEntries,",
          '    server: path.join(__dirname, "src", "joined"),',
          "  },",
          "};",
          'const text = `entry: "./src/string-decoy"`;',
          '// module.exports = { entry: "./src/comment-decoy" };',
          "const buildFakeConfig = (require, path) => ({",
          '  entry: require.resolve("./src/shadowed-require"),',
          "});",
          "module.exports = config;",
        ].join("\n"),
        "webpack-shadowed.js": [
          "const require = (specifier) => specifier;",
          'require("./src/top-level-shadowed");',
        ].join("\n"),
        "src/direct.ts": "export const direct = true;",
        "src/resolved.ts": "export const resolved = true;",
        "src/joined.ts": "export const joined = true;",
        "src/string-decoy.ts": "export const value = true;",
        "src/comment-decoy.ts": "export const value = true;",
        "src/shadowed-require.ts": "export const value = true;",
        "src/top-level-shadowed.ts": "export const value = true;",
      },
      { devDependencies: { webpack: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(getUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/comment-decoy.ts",
      "src/shadowed-require.ts",
      "src/string-decoy.ts",
      "src/top-level-shadowed.ts",
    ]);
  });

  it("follows imported Next plugin bindings and ignores shadowed calls", async () => {
    const rootDirectory = createProject(
      {
        "next.config.mjs": [
          'import makeIntl from "next-intl/plugin";',
          'import { withPlaiceholder as wrapImages } from "@plaiceholder/next";',
          'const withIntl = makeIntl("./src/i18n/live");',
          'const withImages = wrapImages("./src/images/live");',
          'makeIntl("./src/i18n/dormant");',
          'const text = `makeIntl("./src/i18n/string-decoy")`;',
          '// makeIntl("./src/i18n/comment-decoy");',
          'const buildFakeConfig = (makeIntl) => makeIntl("./src/i18n/shadowed");',
          "export default withImages(withIntl({}));",
        ].join("\n"),
        "src/app/page.tsx": "export default () => null;",
        "src/i18n/live.ts": "export const request = true;",
        "src/images/live.ts": "export const image = true;",
        "src/i18n/string-decoy.ts": "export const value = true;",
        "src/i18n/comment-decoy.ts": "export const value = true;",
        "src/i18n/shadowed.ts": "export const value = true;",
        "src/i18n/dormant.ts": "export const value = true;",
      },
      {
        dependencies: {
          "@plaiceholder/next": "1.0.0",
          next: "1.0.0",
          "next-intl": "1.0.0",
          react: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(getUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/i18n/comment-decoy.ts",
      "src/i18n/dormant.ts",
      "src/i18n/shadowed.ts",
      "src/i18n/string-decoy.ts",
    ]);
  });

  it("follows Node createRequire calls without trusting lookalikes", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": [
          'import { createRequire as makeRequire } from "node:module";',
          'import * as nodeModule from "module";',
          "const localRequire = makeRequire(import.meta.url);",
          "const namespaceRequire = nodeModule.createRequire(import.meta.url);",
          'const commonjsRequire = require("node:module").createRequire(import.meta.url);',
          'const { createRequire: commonjsFactory } = require("module");',
          "const destructuredRequire = commonjsFactory(import.meta.url);",
          'localRequire("./loaded");',
          'namespaceRequire.resolve("./resolved");',
          'commonjsRequire("./commonjs");',
          'destructuredRequire("./destructured");',
          'localRequire.context("./context", true, /\\.ts$/);',
          'const useShadow = (localRequire) => localRequire("./shadowed");',
          "console.log(useShadow);",
        ].join("\n"),
        "src/loaded.ts": "export const value = true;",
        "src/resolved.ts": "export const value = true;",
        "src/commonjs.ts": "export const value = true;",
        "src/destructured.ts": "export const value = true;",
        "src/context/orphan.ts": "export const value = true;",
        "src/shadowed.ts": "export const value = true;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(getUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/context/orphan.ts",
      "src/shadowed.ts",
    ]);
  });
});
