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
  it("credits the cli-glob binary alias in package scripts", () => {
    const rootDirectory = createProject(
      {},
      { "cli-glob": "1.0.0", "unused-package": "1.0.0" },
      { prose: "write-good $(glob 'content/**/*.md')" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits binaries after mixed-case environment assignments", () => {
    const rootDirectory = createProject(
      {},
      { "start-server-and-test": "1.0.0", "unused-package": "1.0.0" },
      {
        acceptance:
          "cross-env CYPRESS_baseUrl=http://localhost:8081 start-server-and-test server http://localhost:8081 test",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits declared packages passed as command option values", () => {
    const rootDirectory = createProject(
      {},
      {
        "@cucumber/pretty-formatter": "1.0.0",
        playwright: "1.0.0",
        "unused-package": "1.0.0",
      },
      {
        acceptance: "cucumber-js --format @cucumber/pretty-formatter tests",
        browser: "vitest run --browser.provider=playwright",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits imports nested in ambient module declarations", () => {
    const rootDirectory = createProject(
      {
        "types/turndown-plugin-gfm.d.ts": `
          declare module "joplin-turndown-plugin-gfm" {
            import { Plugin } from "turndown";
            export const gfm: Plugin;
          }
        `,
      },
      { turndown: "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits critters when exported Next config enables CSS optimization", () => {
    const rootDirectory = createProject(
      {
        "next.config.ts": `
          import type { NextConfig } from "next";
          const nextConfig: NextConfig = { experimental: { optimizeCss: true } };
          export default nextConfig;
        `,
      },
      { critters: "1.0.0", next: "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits critters when a Next config function enables CSS optimization", () => {
    const rootDirectory = createProject(
      {
        "next.config.ts": `
          import type { NextConfig } from "next";
          const nextConfig = (phase: string): NextConfig => {
            const basePath = phase === "production" ? "/app" : "";
            return {
              basePath,
              experimental: { optimizeCss: true },
            };
          };
          export default nextConfig;
        `,
      },
      { critters: "1.0.0", next: "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("does not credit critters for disabled or unexported Next config", () => {
    const rootDirectory = createProject(
      {
        "next.config.ts": `
          const dormantConfig = { experimental: { optimizeCss: true } };
          export default { experimental: { optimizeCss: false } };
        `,
      },
      { critters: "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["critters"]);
  });

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

  it("credits package keys in conditional PostCSS plugin maps", () => {
    const rootDirectory = createProject(
      {
        "postcss.config.js": `
          const isProduction = process.env.NODE_ENV === "production";
          module.exports = {
            plugins: {
              autoprefixer: { nestedoption: true },
              ...(isProduction ? { cssnano: {} } : {}),
              ...(isProduction && { "postcss-preset-env": {} }),
            },
          };
        `,
      },
      {
        autoprefixer: "1.0.0",
        cssnano: "1.0.0",
        nestedoption: "1.0.0",
        "postcss-preset-env": "1.0.0",
        "unused-package": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["nestedoption", "unused-package"]);
  });

  it("credits the React plugin enabled by the Antfu ESLint config", () => {
    const dependencies = {
      "@antfu/eslint-config": "2.22.2",
      "@eslint-react/eslint-plugin": "1.0.0",
      "unused-package": "1.0.0",
    };
    const rootDirectory = createProject(
      {
        "eslint.config.mjs": `
          import buildEslintConfig from "@antfu/eslint-config";
          export default buildEslintConfig({ react: true });
        `,
      },
      dependencies,
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits the React plugin enabled with Antfu React options", () => {
    const rootDirectory = createProject(
      {
        "eslint.config.mjs": `
          import antfu from "@antfu/eslint-config";
          export default antfu({ react: { overrides: { "react/example": "off" } } });
        `,
      },
      {
        "@antfu/eslint-config": "2.22.2",
        "@eslint-react/eslint-plugin": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([]);
  });

  it("does not infer the Antfu React plugin from false, nested, commented, or shadowed options", () => {
    const dependencies = {
      "@antfu/eslint-config": "2.22.2",
      "@eslint-react/eslint-plugin": "1.0.0",
    };
    const rootDirectory = createProject(
      {
        "eslint.config.mjs": `
          import buildEslintConfig from "@antfu/eslint-config";
          // buildEslintConfig({ react: true });
          const example = "buildEslintConfig({ react: true })";
          const shadowedCall = () => {
            const buildEslintConfig = () => [];
            return buildEslintConfig({ react: true });
          };
          const uncalledExample = () => buildEslintConfig({ react: true });
          if (false) buildEslintConfig({ react: true });
          console.log(example, shadowedCall, uncalledExample);
          export default buildEslintConfig({ react: false, options: { react: true } });
        `,
      },
      dependencies,
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["@eslint-react/eslint-plugin"]);
  });

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

  it("credits node-addon-api required by authored binding.gyp files", () => {
    const dependencies = {
      "node-active-window": "1.0.0",
      "node-addon-api": "8.2.2",
      "unused-package": "1.0.0",
    };
    const rootDirectory = createProject(
      {
        "package.json": JSON.stringify({
          dependencies,
          overrides: {
            "node-addon-api@<8.2.2": "8.2.2",
            "node-active-window": {
              "node-addon-api": "$node-addon-api",
            },
          },
        }),
        "src/modules/node-active-window/binding.gyp": `
          {
            "targets": [{
              "include_dirs": [
                "<!@(node -p \\"require('node-addon-api').include\\")"
              ],
              "dependencies": [
                "<!(node -p \\"require('node-addon-api').gyp\\")",
                "<!(node -p \\"require('node-addon-api').targets\\"):node_addon_api"
              ]
            }]
          }
        `,
      },
      dependencies,
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "node-active-window",
      "unused-package",
    ]);
  });

  it("credits runtime and test companions required by configured Stencil tooling", () => {
    const dependencies = {
      "@angular/core": "20.3.18",
      "@revolist/stencil-angular-output": "1.1.3",
      "@stencil/angular-output-target": "1.3.0",
      "@stencil/core": "4.43.2",
      "@stencil/vue-output-target": "0.8.9",
      "@types/jest": "29.5.14",
      jest: "29.7.0",
      "jest-cli": "29.7.0",
      rxjs: "7.8.2",
      vue: "3.5.13",
    };
    const rootDirectory = createProject(
      {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { dependencies },
            ...Object.fromEntries(
              Object.entries(dependencies).map(([dependencyName, version]) => [
                `node_modules/${dependencyName}`,
                { version },
              ]),
            ),
            "node_modules/@angular/core": {
              version: "20.3.18",
              peerDependencies: { rxjs: "^6.5.3 || ^7.4.0" },
            },
            "node_modules/rxjs": { version: "7.8.2" },
          },
        }),
        "stencil.config.ts": `
          import { angularOutputTarget } from "@revolist/stencil-angular-output";
          import { Config } from "@stencil/core";
          import { vueOutputTarget as buildVueOutput } from "@stencil/vue-output-target";
          export const config: Config = {
            outputTargets: [angularOutputTarget({}), buildVueOutput({})],
          };
        `,
      },
      dependencies,
      { test: "stencil test --spec" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["@stencil/angular-output-target"]);
  });

  it("does not infer Stencil companions from uncalled, shadowed, or unrelated configuration", () => {
    const rootDirectory = createProject(
      {
        "stencil.config.ts": `
          import { angularOutputTarget } from "@revolist/stencil-angular-output";
          import { Config } from "@stencil/core";
          import { vueOutputTarget } from "@stencil/vue-output-target";
          const deferred = () => {
            const angularOutputTarget = () => ({});
            const vueOutputTarget = () => ({});
            return [angularOutputTarget({}), vueOutputTarget({})];
          };
          {
            const angularOutputTarget = () => ({});
            const vueOutputTarget = () => ({});
            angularOutputTarget({});
            vueOutputTarget({});
          }
          export const unrelated = [angularOutputTarget({}), vueOutputTarget({})];
          export const config: Config = { outputTargets: [], deferred };
        `,
      },
      {
        "@angular/core": "20.3.18",
        "@revolist/stencil-angular-output": "1.1.3",
        "@stencil/core": "4.43.2",
        "@stencil/vue-output-target": "0.8.9",
        "@types/jest": "29.5.14",
        jest: "29.7.0",
        "jest-cli": "29.7.0",
        rxjs: "7.8.2",
        vue: "3.5.13",
      },
      { test: "stencil build --test" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "@angular/core",
      "jest",
      "jest-cli",
      "rxjs",
      "vue",
    ]);
  });

  it.each([
    "stencil build && echo stencil test",
    "echo 'stencil test' && stencil build",
    "stencil build; printf 'stencil test'",
  ])("does not infer Jest companions from unrelated shell text in %s", (testScript) => {
    const rootDirectory = createProject(
      {
        "stencil.config.ts": `
          import type { Config } from "@stencil/core";
          export const config: Config = {};
        `,
      },
      {
        "@stencil/core": "4.43.2",
        jest: "29.7.0",
        "jest-cli": "29.7.0",
      },
      { test: testScript },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["jest", "jest-cli"]);
  });

  it("does not infer node-addon-api from overrides, comments, or inert binding.gyp strings", () => {
    const dependencies = { "node-addon-api": "8.2.2" };
    const rootDirectory = createProject(
      {
        "package.json": JSON.stringify({
          dependencies,
          overrides: { "node-addon-api@<8.2.2": "8.2.2" },
        }),
        "binding.gyp": `
          {
            "note": "require('node-addon-api').include",
            "options": {
              "command": "node -p require('node-addon-api').gyp"
            }
          } # "<!@(node -p \\"require('node-addon-api').include\\")"
          {} // "<!(node -p \\"require('node-addon-api').gyp\\")"
        `,
      },
      dependencies,
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["node-addon-api"]);
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

  it("credits package-runner commands in hook scripts", () => {
    const rootDirectory = createProject(
      { ".husky/pre-commit": `npx pretty-quick --staged` },
      { "pretty-quick": "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits TypeScript type reference directives", () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `/// <reference types="@example/runtime-types" />\nexport const value = true;`,
      },
      { "@example/runtime-types": "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits explicit node_modules references in TypeScript configuration", () => {
    const rootDirectory = createProject(
      {
        "tsconfig.json": JSON.stringify({
          include: ["./node_modules/@sanity/base/types/**/*.ts", "./src/**/*.ts"],
        }),
      },
      { "@sanity/base": "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("credits packages in JSONC TypeScript configuration containing URL strings", () => {
    const rootDirectory = createProject(
      {
        "tsconfig.json": `{
          "$schema": "https://json.schemastore.org/tsconfig",
          "compilerOptions": {
            "plugins": [{ "name": "typescript-plugin-css-modules" }],
          },
        }`,
      },
      { "typescript-plugin-css-modules": "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("does not credit package names in TypeScript configuration without a node_modules path", () => {
    const rootDirectory = createProject(
      { "tsconfig.json": JSON.stringify({ exclude: ["examples/unused-package"] }) },
      { "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("does not credit packages excluded through a node_modules path", () => {
    const rootDirectory = createProject(
      { "tsconfig.json": JSON.stringify({ exclude: ["./node_modules/unused-package/**"] }) },
      { "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it.each(["./node_modules/package-directory", "./node_modules/@scope/package-directory"])(
    "credits terminal node_modules directory references in TypeScript configuration: %s",
    (packagePath) => {
      const packageName = packagePath.slice("./node_modules/".length);
      const rootDirectory = createProject(
        { "tsconfig.json": JSON.stringify({ include: [packagePath] }) },
        { [packageName]: "1.0.0", "unused-package": "1.0.0" },
      );

      expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
    },
  );

  it.each([
    ["font-awesome", "../node_modules/font-awesome/css/font-awesome.min.css"],
    ["@scope/styles", "../node_modules/@scope/styles/index.css"],
  ])("credits explicit node_modules source imports for %s", (packageName, specifier) => {
    const rootDirectory = createProject(
      { "src/index.js": `import ${JSON.stringify(specifier)};` },
      { [packageName]: "1.0.0", "unused-package": "1.0.0" },
    );
    const graph = graphWithReachableImport(path.join(rootDirectory, "src/index.js"), specifier);

    expect(
      detectStalePackages(
        graph,
        defineProjectAnalysisConfig({ rootDir: rootDirectory }),
      ).unusedDependencies.map((dependency) => dependency.name),
    ).toEqual(["unused-package"]);
  });

  it("credits Sanity v2 plugins, core runtime, and required peers", () => {
    const dependencies = {
      "@sanity/base": "2.34.0",
      "@sanity/core": "2.34.0",
      "@sanity/default-layout": "2.34.0",
      "@sanity/vision": "2.34.0",
      "prop-types": "15.8.1",
      react: "17.0.2",
      "react-dom": "17.0.2",
      "styled-components": "5.3.11",
      "unused-package": "1.0.0",
    };
    const rootDirectory = createProject(
      {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": { dependencies },
            "node_modules/@sanity/base": {
              version: "2.34.0",
              peerDependencies: {
                "prop-types": "^15.6",
                react: "^17",
                "react-dom": "^17",
                "styled-components": "^5",
              },
            },
            "node_modules/@sanity/core": { version: "2.34.0" },
            "node_modules/@sanity/default-layout": { version: "2.34.0" },
            "node_modules/@sanity/vision": { version: "2.34.0" },
            "node_modules/prop-types": { version: "15.8.1" },
            "node_modules/react": { version: "17.0.2" },
            "node_modules/react-dom": { version: "17.0.2" },
            "node_modules/styled-components": { version: "5.3.11" },
            "node_modules/unused-package": { version: "1.0.0" },
          },
        }),
        "sanity.json": JSON.stringify({
          root: true,
          plugins: ["@sanity/base", "@sanity/default-layout"],
          env: { development: { plugins: ["@sanity/vision"] } },
        }),
      },
      dependencies,
      { start: "sanity start" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("does not credit nested Sanity manifests or core without a Sanity script", () => {
    const rootDirectory = createProject(
      {
        "examples/sanity.json": JSON.stringify({ root: true, plugins: ["@sanity/base"] }),
        "sanity.json": JSON.stringify({
          root: true,
          project: { name: "unused-package" },
          plugins: [],
          parts: [{ name: "part:@sanity/base/schema", path: "./schemas/schema" }],
        }),
      },
      {
        "@sanity/base": "2.34.0",
        "@sanity/core": "2.34.0",
        "unused-package": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["@sanity/core", "unused-package"]);
  });

  it("credits commands nested in concurrently scripts", () => {
    const rootDirectory = createProject(
      {},
      { concurrently: "1.0.0", "wait-on": "1.0.0", "unused-package": "1.0.0" },
      {
        dev: `concurrently "BROWSER=none npm start" "wait-on http://127.0.0.1:3000 && npm run desktop"`,
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("skips concurrently option values while crediting positional commands", () => {
    const rootDirectory = createProject(
      {},
      { concurrently: "1.0.0", "wait-on": "1.0.0", "unused-package": "1.0.0" },
      {
        dev: `concurrently --names wait-on,web --prefix name "npm start" "wait-on http://127.0.0.1:3000"`,
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("does not treat concurrently non-command option values as commands", () => {
    const rootDirectory = createProject(
      {},
      { concurrently: "1.0.0", "wait-on": "1.0.0" },
      { dev: `concurrently --hide wait-on --shell zsh "npm start"` },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["wait-on"]);
  });

  it("does not treat concurrently bundled short option values as commands", () => {
    const rootDirectory = createProject(
      {},
      { concurrently: "1.0.0", "wait-on": "1.0.0" },
      { dev: `concurrently -kn wait-on "npm start"` },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["wait-on"]);
  });

  it("credits concurrently teardown commands", () => {
    const rootDirectory = createProject(
      {},
      { concurrently: "1.0.0", "wait-on": "1.0.0" },
      { dev: `concurrently --teardown "wait-on http://127.0.0.1:3000" "npm start"` },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([]);
  });

  it("does not treat quoted arguments of ordinary commands as nested commands", () => {
    const rootDirectory = createProject(
      {},
      { "wait-on": "1.0.0" },
      { dev: `echo "wait-on http://127.0.0.1:3000"` },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["wait-on"]);
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

  it("credits imports in twoslash code fences without crediting ordinary examples", () => {
    const rootDirectory = createProject(
      {
        "docs/examples.mdx": [
          "```ts twoslash",
          'import type { Node } from "@babel/types";',
          'import render from "estree-to-babel";',
          "/**",
          " * @import {File} from 'jsdoc-import-package'",
          " */",
          "```",
          "",
          "```ts",
          'import Example from "documentation-only-package";',
          "```",
        ].join("\n"),
      },
      {
        "@babel/types": "1.0.0",
        "documentation-only-package": "1.0.0",
        "estree-to-babel": "1.0.0",
        "jsdoc-import-package": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["documentation-only-package"]);
  });

  it.each(["md", "mdx"])(
    "credits live imports in authored .%s documents without crediting examples or prose",
    (extension) => {
      const rootDirectory = createProject(
        {
          [`docs/player.${extension}`]: [
            "---",
            "title: Player",
            "---",
            'import ReactPlayer from "react-player";',
            "",
            "<!--",
            'import CommentedPlayer from "commented-player";',
            "-->",
            "```tsx",
            'import FencedPlayer from "fenced-player";',
            "```",
            '    import IndentedPlayer from "indented-player";',
            '`import InlinePlayer from "inline-player";`',
            "<ReactPlayer />",
          ].join("\n"),
        },
        {
          "@docusaurus/core": "1.0.0",
          "commented-player": "1.0.0",
          "fenced-player": "1.0.0",
          "indented-player": "1.0.0",
          "inline-player": "1.0.0",
          "react-player": "1.0.0",
        },
      );

      expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
        "commented-player",
        "fenced-player",
        "indented-player",
        "inline-player",
      ]);
    },
  );

  it("does not credit import examples or frontmatter in plain Markdown", () => {
    const rootDirectory = createProject(
      {
        "README.md": [
          "---",
          "description: |",
          '  import FrontmatterExample from "frontmatter-package"',
          "---",
          'import Example from "example-package";',
        ].join("\n"),
      },
      {
        "example-package": "1.0.0",
        "frontmatter-package": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "example-package",
      "frontmatter-package",
    ]);
  });

  it("credits multiline module statements in authored Markdown", () => {
    const rootDirectory = createProject(
      {
        "docs/modules.mdx": [
          "import {",
          "  NamedPlayer",
          "}",
          'from "named-player"',
          "",
          "import DefaultPlayer",
          'from "default-player"',
          "",
          "export {",
          "  ExportedPlayer",
          "}",
          'from "exported-player"',
        ].join("\n"),
      },
      {
        "default-player": "1.0.0",
        "exported-player": "1.0.0",
        "named-player": "1.0.0",
        "unused-package": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("normalizes Babel module-prefixed preset specifiers only in Babel config", () => {
    const rootDirectory = createProject(
      {
        "babel.config.js": `
          module.exports = {
            presets: [
              "module:metro-react-native-babel-preset",
              ["module:real-plugin", { plugins: ["module:nested-option-package"] }],
            ],
            label: "module:not-a-babel-preset",
            // "module:commented-preset"
          };
        `,
        "vite.config.js": `export default { label: "module:not-a-babel-preset" };`,
      },
      {
        "commented-preset": "1.0.0",
        "metro-react-native-babel-preset": "1.0.0",
        "nested-option-package": "1.0.0",
        "not-a-babel-preset": "1.0.0",
        "real-plugin": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([
      "commented-preset",
      "nested-option-package",
      "not-a-babel-preset",
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

  it("credits required peers of conventionally used config packages", () => {
    const rootDirectory = createProject(
      {
        "package-lock.json": JSON.stringify({
          lockfileVersion: 3,
          packages: {
            "": {
              devDependencies: {
                "babel-eslint": "10.1.0",
                "eslint-config-example": "1.0.0",
              },
            },
            "node_modules/babel-eslint": { version: "10.1.0" },
            "node_modules/eslint-config-example": {
              version: "1.0.0",
              peerDependencies: { "babel-eslint": "^10.0.0" },
            },
          },
        }),
      },
      {},
    );
    fs.writeFileSync(
      path.join(rootDirectory, "package.json"),
      JSON.stringify({
        devDependencies: {
          "babel-eslint": "10.1.0",
          "eslint-config-example": "1.0.0",
        },
      }),
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([]);
  });

  it("credits Ajv as the implementation selected by the RJSF Ajv 8 validator", () => {
    const rootDirectory = createProject(
      { "src/index.ts": `import validator from "@rjsf/validator-ajv8"; console.log(validator);` },
      { "@rjsf/validator-ajv8": "1.0.0", ajv: "8.18.0", "unused-package": "1.0.0" },
    );

    const graph = graphWithReachableImport(
      path.join(rootDirectory, "src/index.ts"),
      "@rjsf/validator-ajv8",
    );

    expect(
      detectStalePackages(graph, defineProjectAnalysisConfig({ rootDir: rootDirectory }))
        .unusedDependencies.map((dependency) => dependency.name)
        .sort(),
    ).toEqual(["unused-package"]);
  });

  it("does not credit Ajv without the RJSF Ajv 8 validator", () => {
    const rootDirectory = createProject(
      { "src/index.ts": `export const value = true;` },
      { ajv: "8.18.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["ajv"]);
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

  it("credits Sass from an unquoted Parcel HTML stylesheet link", () => {
    const rootDirectory = createProject(
      {
        "src/build.js": `
          const Bundler = require("parcel-bundler");
          new Bundler(path.join(__dirname, "./html/index.html"), {});
        `,
        "src/html/index.html": "<link rel=stylesheet href=../styles/app.scss>",
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

  it("credits the Supabase CLI from its root project config", () => {
    const rootDirectory = createProject(
      { "supabase/config.toml": 'project_id = "example"' },
      { supabase: "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("does not credit the Supabase CLI from a nested config", () => {
    const rootDirectory = createProject(
      { "examples/app/supabase/config.toml": 'project_id = "example"' },
      { supabase: "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["supabase"]);
  });

  it.each(["js", "cjs", "mjs", "ts", "cts", "mts"])(
    "credits declared package keys in react-native.config.%s",
    (extension) => {
      const rootDirectory = createProject(
        {
          [`react-native.config.${extension}`]: `
            module.exports = {
              dependencies: {
                expo: { platforms: { android: null, ios: null } },
                "@scope/native-tool": { platforms: { android: null } },
                undeclared: {},
              },
            };
          `,
        },
        {
          expo: "1.0.0",
          "@scope/native-tool": "1.0.0",
          "unused-package": "1.0.0",
        },
      );

      expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
    },
  );

  it("does not credit nested dependency-shaped objects in React Native config", () => {
    const rootDirectory = createProject(
      {
        "react-native.config.js": `
          module.exports = {
            project: { dependencies: { dormant: {} } },
          };
        `,
      },
      { dormant: "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["dormant"]);
  });

  it("credits packages imported by installed agent skill code", () => {
    const rootDirectory = createProject(
      {
        "skills-lock.json": JSON.stringify({ skills: { "media-skill": {} } }),
        ".agents/skills/media-skill/SKILL.md": "Read the routed rule.",
        ".agents/skills/media-skill/rules/audio.md": `Use this implementation:

\`\`\`tsx
import { visualizeAudio } from "@example/media-utils";
\`\`\``,
      },
      { "@example/media-utils": "1.0.0", "unused-package": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["unused-package"]);
  });

  it("does not credit code in an uninstalled agent skill", () => {
    const rootDirectory = createProject(
      {
        "skills-lock.json": JSON.stringify({ skills: {} }),
        ".agents/skills/media-skill/SKILL.md": `\`\`\`tsx
import { visualizeAudio } from "@example/media-utils";
\`\`\``,
      },
      { "@example/media-utils": "1.0.0" },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual(["@example/media-utils"]);
  });

  it("credits packages imported by installed agent skill source files", () => {
    const rootDirectory = createProject(
      {
        "skills-lock.json": JSON.stringify({ skills: { "media-skill": {} } }),
        ".agents/skills/media-skill/SKILL.md": "Read the implementation.",
        ".agents/skills/media-skill/assets/audio.tsx": [
          'require("@example/require-utils");',
          'import("@example/dynamic-utils");',
          'type Media = import("@example/type-utils").Media;',
          'import media = require("@example/import-equals-utils");',
          "require(`@example/require-template-utils`);",
          "import(`@example/dynamic-template-utils`);",
        ].join("\n"),
      },
      {
        "@example/require-utils": "1.0.0",
        "@example/dynamic-utils": "1.0.0",
        "@example/type-utils": "1.0.0",
        "@example/import-equals-utils": "1.0.0",
        "@example/require-template-utils": "1.0.0",
        "@example/dynamic-template-utils": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([]);
  });

  it("credits imports in installed agent skill code fragments", () => {
    const rootDirectory = createProject(
      {
        "skills-lock.json": JSON.stringify({ skills: { "media-skill": {} } }),
        ".agents/skills/media-skill/SKILL.md": `\`\`\`tsx
return <Visualizer />;
import { visualizeAudio } from "@example/media-utils";
require(\`@example/require-template-utils\`);
import(\`@example/dynamic-template-utils\`);
\`\`\``,
      },
      {
        "@example/media-utils": "1.0.0",
        "@example/require-template-utils": "1.0.0",
        "@example/dynamic-template-utils": "1.0.0",
      },
    );

    expect(collectUnusedDependencyNames(rootDirectory)).toEqual([]);
  });

  it("credits a local file dependency mapped to its source by tsconfig paths", () => {
    const rootDirectory = createProject(
      {
        "packages/example/package.json": JSON.stringify({
          dependencies: { "local-package": "file:.." },
        }),
        "packages/example/tsconfig.json": JSON.stringify({
          compilerOptions: { paths: { "local-package": ["../src/index"] } },
        }),
        "packages/src/index.ts": "export const value = 1;",
      },
      {},
    );
    const exampleDirectory = path.join(rootDirectory, "packages/example");

    expect(collectUnusedDependencyNames(exampleDirectory)).toEqual([]);
  });

  it("does not credit a local file dependency mapped outside its target", () => {
    const rootDirectory = createProject(
      {
        "packages/example/package.json": JSON.stringify({
          dependencies: { "local-package": "file:../local-package" },
        }),
        "packages/example/tsconfig.json": JSON.stringify({
          compilerOptions: { paths: { "local-package": ["../../unrelated/index"] } },
        }),
        "packages/local-package/package.json": JSON.stringify({ name: "local-package" }),
        "unrelated/index.ts": "export const value = 1;",
      },
      {},
    );
    const exampleDirectory = path.join(rootDirectory, "packages/example");

    expect(collectUnusedDependencyNames(exampleDirectory)).toEqual(["local-package"]);
  });

  it("resolves local file dependency wildcard paths from tsconfig baseUrl", () => {
    const rootDirectory = createProject(
      {
        "packages/example/package.json": JSON.stringify({
          dependencies: { "local-package": "file:../local-package" },
        }),
        "packages/example/tsconfig.json": JSON.stringify({
          compilerOptions: {
            baseUrl: "../local-package",
            paths: { "local-package/*": ["src/*"] },
          },
        }),
        "packages/local-package/src/index.ts": "export const value = 1;",
      },
      {},
    );
    const exampleDirectory = path.join(rootDirectory, "packages/example");

    expect(collectUnusedDependencyNames(exampleDirectory)).toEqual([]);
  });

  it("resolves local file dependencies from a monorepo tsconfig", () => {
    const rootDirectory = createProject(
      {
        "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
        "tsconfig.json": JSON.stringify({
          compilerOptions: { paths: { "local-package": ["packages/local-package/src/index"] } },
        }),
        "packages/example/package.json": JSON.stringify({
          dependencies: { "local-package": "file:../local-package" },
        }),
        "packages/local-package/src/index.ts": "export const value = 1;",
      },
      {},
    );
    const exampleDirectory = path.join(rootDirectory, "packages/example");

    expect(collectUnusedDependencyNames(exampleDirectory)).toEqual([]);
  });
});
