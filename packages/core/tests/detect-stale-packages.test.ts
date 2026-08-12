import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { defineProjectAnalysisConfig } from "../src/project-analysis/config.js";
import { detectStalePackages } from "../src/project-analysis/report/packages.js";
import type { DependencyGraph } from "../src/project-analysis/types.js";
import { isConfigFile } from "../src/project-analysis/utils/is-config-file.js";

const temporaryDirectories: string[] = [];

const emptyGraph: DependencyGraph = {
  modules: [],
  edges: [],
  reverseEdges: new Map(),
  fileIdMap: new Map(),
};

const graphWithReachableImport = (filePath: string, specifier: string): DependencyGraph => ({
  modules: [
    {
      fileId: { index: 0, path: filePath },
      imports: [
        {
          specifier,
          importedNames: [],
          isTypeOnly: false,
          isDynamic: false,
          isSideEffect: true,
          line: 1,
          column: 1,
        },
      ],
      exports: [],
      memberAccesses: [],
      wholeObjectUses: [],
      localIdentifierReferences: [],
      topLevelImportReferences: [],
      referencedFilenames: [],
      parseErrors: [],
      isEntryPoint: true,
      isExternallyConsumed: false,
      isTestEntry: false,
      isReachable: true,
      isDeclarationFile: false,
      isConfigFile: false,
      isGitIgnored: false,
      isAnalysisExcluded: false,
    },
  ],
  edges: [],
  reverseEdges: new Map(),
  fileIdMap: new Map([[filePath, 0]]),
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
  dependencies: Readonly<Record<string, string>>,
  scripts: Readonly<Record<string, string>> = {},
): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-packages-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(
    path.join(rootDirectory, "package.json"),
    JSON.stringify({ dependencies, scripts }),
  );
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  if (!("package-lock.json" in files) && !("yarn.lock" in files)) {
    fs.writeFileSync(
      path.join(rootDirectory, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": { dependencies },
          ...Object.fromEntries(
            Object.keys(dependencies).map((dependencyName) => [
              `node_modules/${dependencyName}`,
              { version: "1.0.0" },
            ]),
          ),
        },
      }),
    );
  }
  return fs.realpathSync(rootDirectory);
};

const collectUnusedDependencyNames = (rootDirectory: string): string[] =>
  detectStalePackages(emptyGraph, defineProjectAnalysisConfig({ rootDir: rootDirectory }))
    .unusedDependencies.map((dependency) => dependency.name)
    .sort();

describe("detectStalePackages", () => {
  it("fails closed when a used package has no authoritative peer metadata", () => {
    const rootDirectory = createProject(
      {
        "yarn.lock": "# yarn lockfile v1\n",
        "src/index.ts": `import "used-package";`,
      },
      { "used-package": "1.0.0", "unused-package": "1.0.0" },
    );

    const report = detectStalePackages(
      emptyGraph,
      defineProjectAnalysisConfig({ rootDir: rootDirectory }),
    );

    expect(report.unusedDependencies).toEqual([]);
    expect(report.skippedDependencies).toContainEqual({
      name: "unused-package",
      isDevDependency: false,
      reasons: ["incomplete-peer-metadata"],
    });
  });

  it("fails closed when a graph-used package has no authoritative peer metadata", () => {
    const rootDirectory = createProject(
      { "yarn.lock": "# yarn lockfile v1\n", "src/index.ts": "" },
      { "used-package": "1.0.0", "unused-package": "1.0.0" },
    );
    const graph = graphWithReachableImport(
      path.join(rootDirectory, "src/index.ts"),
      "used-package",
    );

    const report = detectStalePackages(
      graph,
      defineProjectAnalysisConfig({ rootDir: rootDirectory }),
    );

    expect(report.unusedDependencies).toEqual([]);
    expect(report.skippedDependencies).toContainEqual({
      name: "unused-package",
      isDevDependency: false,
      reasons: ["incomplete-peer-metadata"],
    });
  });

  it.each(["js", "ts", "mjs", "cjs"])(
    "credits Gatsby plugin strings in gatsby-config.%s",
    (extension) => {
      const rootDirectory = createProject(
        {
          [`gatsby-config.${extension}`]: `
            export default {
              plugins: [
                "gatsby-plugin-image",
                { resolve: "gatsby-source-filesystem" },
              ],
            };
          `,
        },
        {
          "gatsby-plugin-image": "1.0.0",
          "gatsby-source-filesystem": "1.0.0",
          "unused-package": "1.0.0",
        },
      );

      expect(isConfigFile(path.join(rootDirectory, `gatsby-config.${extension}`))).toBe(true);
      expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
    },
  );

  it("does not credit package names from comments or strings in unrelated files", () => {
    const rootDirectory = createProject(
      {
        "gatsby-config.txt": "gatsby-plugin-image",
        "src/notes.ts": `
          // gatsby-source-filesystem
          export const packageName = "gatsby-plugin-sharp";
        `,
      },
      {
        "gatsby-plugin-image": "1.0.0",
        "gatsby-plugin-sharp": "1.0.0",
        "gatsby-source-filesystem": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "gatsby-plugin-image",
      "gatsby-plugin-sharp",
      "gatsby-source-filesystem",
    ]);
  });

  it("does not credit ledger package names from config comments or identifier substrings", () => {
    const rootDirectory = createProject(
      {
        "gatsby-config.js": `
          export default {
            plugins: [
              // "gatsby-plugin-offline",
            ],
          };
        `,
        "build/Gruntfile.js": `
          // The app directory is resolved from the repository root.
          const appDirectory = path.join("packages", "client-app");
          console.log(appDirectory);
        `,
      },
      {
        "gatsby-plugin-offline": "1.0.0",
        he: "1.0.0",
        joi: "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "gatsby-plugin-offline",
      "he",
      "joi",
    ]);
  });

  it("does not credit commented or quoted import examples during source rescue", () => {
    const rootDirectory = createProject(
      {
        "src/examples.ts": `
          // import "commented-package";
          const example = 'import("string-package")';
          // node_modules/commented-path-package/index.js
          const pathExample = "node_modules/string-path-package/index.js";
          console.log(example, pathExample);
        `,
      },
      {
        "commented-package": "1.0.0",
        "commented-path-package": "1.0.0",
        "string-path-package": "1.0.0",
        "string-package": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "commented-package",
      "commented-path-package",
      "string-package",
      "string-path-package",
    ]);
  });

  it("credits an override target only when the overridden package is used", () => {
    const dependencies = {
      "override-target": "1.0.0",
      "source-package": "1.0.0",
    };
    const packageJson = JSON.stringify({
      dependencies,
      overrides: { "source-package": "npm:override-target@1.0.0" },
    });
    const unusedRootDirectory = createProject({ "package.json": packageJson }, dependencies);
    const usedRootDirectory = createProject(
      {
        "package.json": packageJson,
        "src/index.ts": `import "source-package";`,
      },
      dependencies,
    );

    expect(collectUnusedDependencyNames(unusedRootDirectory)).toEqual([
      "override-target",
      "source-package",
    ]);
    expect(collectUnusedDependencyNames(usedRootDirectory)).toEqual([]);
  });

  it("credits dynamic imports in tracked HTML entry files", () => {
    const rootDirectory = createProject(
      { "index.html": `<script type="module">import("react-grab");</script>` },
      { "react-grab": "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits package imports in tracked dot-directory source files", () => {
    const rootDirectory = createProject(
      { ".vn/tests/auth.test.ts": `import request from "supertest";` },
      { supertest: "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits explicit node_modules references in hook scripts", () => {
    const rootDirectory = createProject(
      { ".husky/commit-msg": `node_modules/@evilmartians/lefthook/bin/lefthook run` },
      { "@evilmartians/lefthook": "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it.each([
    ["android/build.gradle", `apply from: "../node_modules/native-plugin/plugin.gradle"`],
    ["src/styles.scss", `@import "../node_modules/style-package/index";`],
    [
      "patches/runtime-package.patch",
      `diff --git a/node_modules/runtime-package/index.js b/node_modules/runtime-package/index.js`,
    ],
  ])("credits explicit node_modules references in %s", (relativePath, source) => {
    const rootDirectory = createProject(
      { [relativePath]: source },
      { "native-plugin": "1.0.0", "style-package": "1.0.0", "runtime-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(
      ["native-plugin", "runtime-package", "style-package"].filter(
        (packageName) => !source.includes(`node_modules/${packageName}`),
      ),
    );
  });

  it("credits a package targeted by a patch-package filename", () => {
    const rootDirectory = createProject(
      { "patches/@scope+patched-package+1.2.3.patch": `--- a/index.js\n+++ b/index.js` },
      { "@scope/patched-package": "1.2.3", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it.each([
    ["src/config.coffee", `Emitter = require("emissary")`],
    ["contracts/token.sol", `import "@openzeppelin/contracts/token/ERC20/ERC20.sol";`],
    ["types/plugin.d.ts", `export type Plugin = import("typed-package").Plugin;`],
  ])("credits package imports in authored %s files", (relativePath, source) => {
    const rootDirectory = createProject(
      { [relativePath]: source },
      {
        emissary: "1.0.0",
        "@openzeppelin/contracts": "1.0.0",
        "typed-package": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(
      ["@openzeppelin/contracts", "emissary", "typed-package"].filter(
        (packageName) => !source.includes(packageName),
      ),
    );
  });

  it("does not credit documentation or arbitrary patch text", () => {
    const rootDirectory = createProject(
      {
        "docs/example.md": `\`\`\`ts\nimport value from "documentation-only-package";\n\`\`\``,
        "patches/example.patch": `+ console.log("node_modules/patch-text-only-package/index.js")`,
      },
      {
        "documentation-only-package": "1.0.0",
        "patch-text-only-package": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "documentation-only-package",
      "patch-text-only-package",
    ]);
  });

  it("credits Grunt plugins referenced by registered task names", () => {
    const rootDirectory = createProject(
      { "Gruntfile.js": `grunt.registerTask("test", ["karma"]);` },
      { karma: "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits workspace package binaries invoked by scripts", () => {
    const dependencies = { "@sa/scripts": "workspace:*", "unused-package": "1.0.0" };
    const scripts = { cleanup: "sa cleanup" };
    const rootDirectory = createProject(
      {
        "package.json": JSON.stringify({
          private: true,
          workspaces: ["packages/*"],
          dependencies,
          scripts,
        }),
        "packages/scripts/package.json": JSON.stringify({
          name: "@sa/scripts",
          bin: { sa: "./bin.ts" },
        }),
      },
      dependencies,
      scripts,
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits exact package-lock binary and required peer metadata", () => {
    const rootDirectory = createProject(
      {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": {
              dependencies: { "tool-package": "2.0.0", "peer-package": "3.1.0" },
            },
            "node_modules/tool-package": {
              version: "2.0.0",
              bin: { tool: "bin.js" },
              peerDependencies: { "peer-package": "^3.0.0" },
            },
            "node_modules/peer-package": { version: "3.1.0" },
          },
        }),
        "src/index.ts": `import "tool-package";`,
      },
      { "tool-package": "2.0.0", "peer-package": "3.1.0" },
      { build: "tool build" },
    );
    const graph = graphWithReachableImport(
      path.join(rootDirectory, "src/index.ts"),
      "tool-package",
    );

    expect(
      detectStalePackages(graph, defineProjectAnalysisConfig({ rootDir: rootDirectory }))
        .unusedDependencies,
    ).toEqual([]);
  });

  it("does not credit optional or stale-version lockfile peers", () => {
    const rootDirectory = createProject(
      {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": {
              dependencies: {
                "tool-package": "2.0.0",
                "optional-peer": "1.0.0",
                "stale-peer": "1.0.0",
              },
            },
            "node_modules/old-tool-package": {
              version: "1.0.0",
              peerDependencies: { "stale-peer": "^1.0.0" },
            },
            "node_modules/tool-package": {
              version: "2.0.0",
              peerDependencies: { "optional-peer": "^1.0.0" },
              peerDependenciesMeta: { "optional-peer": { optional: true } },
            },
            "node_modules/parent-package/node_modules/tool-package": {
              version: "1.0.0",
              peerDependencies: { "stale-peer": "^1.0.0" },
            },
          },
        }),
        "src/index.ts": `import "tool-package";`,
      },
      {
        "tool-package": "2.0.0",
        "optional-peer": "1.0.0",
        "stale-peer": "1.0.0",
      },
    );
    const graph = graphWithReachableImport(
      path.join(rootDirectory, "src/index.ts"),
      "tool-package",
    );

    expect(
      detectStalePackages(
        graph,
        defineProjectAnalysisConfig({ rootDir: rootDirectory }),
      ).unusedDependencies.map((dependency) => dependency.name),
    ).toEqual(["optional-peer", "stale-peer"]);
  });

  it("does not infer react-refresh from a static wrapper name", () => {
    const rootDirectory = createProject(
      {
        ".apprc.js": `
          const ReactRefreshPlugin = require("@pmmmwh/react-refresh-webpack-plugin");
          export default ReactRefreshPlugin;
        `,
      },
      {
        "@pmmmwh/react-refresh-webpack-plugin": "1.0.0",
        "react-refresh": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["react-refresh"]);
  });

  it("does not credit a binary from a nested stale version of the same package", () => {
    const rootDirectory = createProject(
      {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { dependencies: { "tool-package": "2.0.0" } },
            "node_modules/tool-package": {
              version: "2.0.0",
              bin: { currentTool: "current.js" },
            },
            "node_modules/parent-package/node_modules/tool-package": {
              version: "1.0.0",
              bin: { staleTool: "stale.js" },
            },
          },
        }),
      },
      { "tool-package": "2.0.0" },
      { build: "staleTool build" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["tool-package"]);
  });

  it("does not credit a binary from a stale installed package version", () => {
    const rootDirectory = createProject(
      {
        "yarn.lock": "# yarn lockfile v1\n",
        "node_modules/tool-package/package.json": JSON.stringify({
          name: "tool-package",
          version: "1.0.0",
          bin: { staleTool: "stale.js" },
        }),
      },
      { "tool-package": "2.0.0" },
      { build: "staleTool build" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["tool-package"]);
  });

  it("uses child-resolution lock metadata instead of a hoisted different version", () => {
    const childDependencies = {
      "consumer-package": "2.0.0",
      "peer-from-root-version": "1.0.0",
      "unused-package": "1.0.0",
    };
    const rootDirectory = createProject(
      {
        "package.json": JSON.stringify({ private: true, workspaces: ["packages/*"] }),
        "packages/app/package.json": JSON.stringify({
          name: "app",
          dependencies: childDependencies,
        }),
        "packages/app/src/index.ts": `import "consumer-package";`,
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { workspaces: ["packages/*"] },
            "packages/app": { dependencies: childDependencies },
            "node_modules/consumer-package": {
              version: "1.0.0",
              peerDependencies: { "peer-from-root-version": "^1.0.0" },
            },
            "packages/app/node_modules/consumer-package": { version: "2.0.0" },
            "node_modules/peer-from-root-version": { version: "1.0.0" },
            "node_modules/unused-package": { version: "1.0.0" },
          },
        }),
      },
      {},
    );
    const childDirectory = path.join(rootDirectory, "packages/app");

    expect(collectUnusedDependencyNames(childDirectory)).toEqual([
      "peer-from-root-version",
      "unused-package",
    ]);
  });

  it("credits package imports in statically linked build scripts", () => {
    const rootDirectory = createProject(
      {
        "build/build.js": `
          require("direct-build-package");
          require("./webpack.prod.conf");
        `,
        "build/webpack.prod.conf.js": `
          import plugin from "transitive-build-package";
          const baseConfig = { entry: { app: "./src/client" } };
          baseConfig.entry.app = ["./build/dev-client"].concat(baseConfig.entry.app);
          export default plugin;
        `,
        "build/dev-client.js": `require("webpack-entry-package");`,
        "src/client.js": `require("root-webpack-entry-package");`,
        "build/dormant.js": `require("dormant-build-package");`,
      },
      {
        "direct-build-package": "1.0.0",
        "transitive-build-package": "1.0.0",
        "webpack-entry-package": "1.0.0",
        "root-webpack-entry-package": "1.0.0",
        "dormant-build-package": "1.0.0",
      },
      { build: "node build/build.js" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["dormant-build-package"]);
  });

  it("credits package imports in config helper trees", () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `import { setupPlugins } from "./build/plugins"; export default setupPlugins();`,
        "build/plugins/index.ts": `import { inspect } from "./inspect"; export const setupPlugins = () => inspect;`,
        "build/plugins/inspect.ts": `import boxen from "boxen"; export const inspect = boxen;`,
        "build/plugins/dormant.ts": `import chalk from "chalk"; export const dormant = chalk;`,
      },
      { boxen: "1.0.0", chalk: "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["chalk"]);
  });

  it("does not follow dynamic build-script imports or package-name text", () => {
    const rootDirectory = createProject(
      {
        "build/build.js": `
          const packageName = "text-only-package";
          const configName = process.env.CONFIG;
          require("./" + configName);
          const config = { template: "./production" };
          console.log(packageName, config);
        `,
        "build/production.js": `require("dynamic-build-package");`,
      },
      {
        "text-only-package": "1.0.0",
        "dynamic-build-package": "1.0.0",
      },
      { build: "node build/build.js" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "dynamic-build-package",
      "text-only-package",
    ]);
  });

  it("credits Sass compiled from programmatic Parcel HTML entries", () => {
    const rootDirectory = createProject(
      {
        "src/build.js": `
          const Bundler = require("parcel-bundler");
          const entryFiles = path.join(__dirname, "./html/*.html");
          new Bundler(entryFiles, {});
        `,
        "src/html/index.html": '<link rel="stylesheet" href="../styles/app.scss">',
        "src/styles/app.scss": "$color: red;",
      },
      { "parcel-bundler": "1.0.0", sass: "1.0.0" },
      { build: "node src/build.js" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([]);
  });

  it("does not credit Sass from an unconsumed Parcel HTML path", () => {
    const rootDirectory = createProject(
      {
        "src/build.js": `
          const Bundler = require("parcel-bundler");
          const dormantEntry = path.join(__dirname, "./html/*.html");
          console.log(Bundler, dormantEntry);
        `,
        "src/html/index.html": '<link rel="stylesheet" href="../styles/app.scss">',
        "src/styles/app.scss": "$color: red;",
      },
      { "parcel-bundler": "1.0.0", sass: "1.0.0" },
      { build: "node src/build.js" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["sass"]);
  });

  it("credits Stylus compiled by a used React Native transformer", () => {
    const rootDirectory = createProject(
      {
        "metro.config.js": `module.exports = require("react-native-stylus-transformer");`,
        "src/screen.tsx": `const styles = require("./screen.styl");`,
      },
      {
        "react-native-stylus-transformer": "1.0.0",
        stylus: "1.0.0",
      },
    );
    const graph = graphWithReachableImport(
      path.join(rootDirectory, "src/screen.tsx"),
      "./screen.styl",
    );

    expect(
      detectStalePackages(graph, defineProjectAnalysisConfig({ rootDir: rootDirectory }))
        .unusedDependencies,
    ).toEqual([]);
  });

  it("does not credit a style compiler through an unused host declaration", () => {
    const rootDirectory = createProject(
      { "src/screen.tsx": `const styles = require("./screen.styl");` },
      { "stylus-loader": "1.0.0", stylus: "1.0.0" },
    );
    const graph = graphWithReachableImport(
      path.join(rootDirectory, "src/screen.tsx"),
      "./screen.styl",
    );

    expect(
      detectStalePackages(
        graph,
        defineProjectAnalysisConfig({ rootDir: rootDirectory }),
      ).unusedDependencies.map((dependency) => dependency.name),
    ).toEqual(["stylus"]);
  });
});
