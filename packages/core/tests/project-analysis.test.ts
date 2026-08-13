import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";
import { MINIFIED_DETECTION_MIN_BYTES } from "../src/project-analysis/constants.js";
import { isProjectAnalysisExcludedPath } from "../src/project-analysis/utils/is-project-analysis-excluded-path.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createProject = (
  files: Readonly<Record<string, string>>,
  packageJson: Readonly<Record<string, unknown>>,
): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-project-analysis-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  const dependencies = {
    ...(typeof packageJson.dependencies === "object" && packageJson.dependencies !== null
      ? packageJson.dependencies
      : {}),
    ...(typeof packageJson.devDependencies === "object" && packageJson.devDependencies !== null
      ? packageJson.devDependencies
      : {}),
  };
  if (
    !("package-lock.json" in files) &&
    !Object.keys(files).some((relativePath) => relativePath.startsWith("node_modules/"))
  ) {
    fs.writeFileSync(
      path.join(rootDirectory, "package-lock.json"),
      JSON.stringify({
        lockfileVersion: 3,
        packages: {
          "": {
            dependencies: packageJson.dependencies,
            devDependencies: packageJson.devDependencies,
          },
          ...Object.fromEntries(
            Object.entries(dependencies).map(([dependencyName, version]) => [
              `node_modules/${dependencyName}`,
              { version },
            ]),
          ),
        },
      }),
    );
  }
  return fs.realpathSync(rootDirectory);
};

const relativePath = (rootDirectory: string, filePath: string): string =>
  path.relative(rootDirectory, filePath).replaceAll("\\", "/");

const relativePaths = (
  rootDirectory: string,
  findings: ReadonlyArray<{ readonly path: string }>,
): string[] => findings.map((finding) => relativePath(rootDirectory, finding.path));

describe("analyzeProject", () => {
  it("does not inherit generated or vendor ownership from checkout ancestors", () => {
    const projectRoot = path.join(os.tmpdir(), "vendor", "generated", "application");

    expect(
      isProjectAnalysisExcludedPath(path.join(projectRoot, "src", "index.ts"), projectRoot),
    ).toBe(false);
    expect(
      isProjectAnalysisExcludedPath(
        path.join(projectRoot, "src", "vendor", "library.ts"),
        projectRoot,
      ),
    ).toBe(true);
  });

  it("reports all six graph diagnostics, including unused type exports", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import usedPackage from "used-package";
          import { liveValue } from "./library";
          import { cycleA } from "./cycle-a";
          console.log(usedPackage, liveValue, cycleA);
        `,
        "src/library.ts": `
          export const liveValue = 1;
          export const unusedValue = 2;
          export interface UnusedShape { value: string }
        `,
        "src/orphan.ts": "export const orphan = true;",
        "src/cycle-a.ts": `
          import { cycleB } from "./cycle-b";
          export const cycleA = cycleB + 1;
        `,
        "src/cycle-b.ts": `
          import { cycleA } from "./cycle-a";
          export const cycleB = cycleA + 1;
        `,
      },
      {
        dependencies: { "used-package": "1.0.0", "unused-package": "1.0.0" },
        devDependencies: { "unused-dev-package": "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/orphan.ts");
    expect(result.unusedExports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "unusedValue", isTypeOnly: false }),
        expect.objectContaining({ name: "UnusedShape", isTypeOnly: true }),
      ]),
    );
    expect(result.unusedDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "unused-package", isDevDependency: false }),
        expect.objectContaining({ name: "unused-dev-package", isDevDependency: true }),
      ]),
    );
    expect(result.circularDependencies).toEqual([
      expect.objectContaining({
        files: expect.any(Array),
      }),
    ]);
    expect(
      result.circularDependencies[0]?.files.map((filePath) =>
        relativePath(rootDirectory, filePath),
      ),
    ).toEqual(expect.arrayContaining(["src/cycle-a.ts", "src/cycle-b.ts"]));
  });

  it("keeps exported types referenced by other exported type declarations", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts":
          'import type { PublicShape } from "./library"; console.log({} as PublicShape);',
        "src/library.ts": `
          export interface SharedShape { value: string }
          export type PublicShape = SharedShape & { enabled: boolean };
          export interface ExtendedShape extends SharedShape { count: number }
          export type UnusedShape = { stale: boolean };
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedExportNames = result.unusedExports.map((unusedExport) => unusedExport.name);

    expect(unusedExportNames).not.toContain("SharedShape");
    expect(unusedExportNames).not.toContain("PublicShape");
    expect(unusedExportNames).toContain("ExtendedShape");
    expect(unusedExportNames).toContain("UnusedShape");
  });

  it("tracks TypeScript import type queries as type-only graph edges", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          export type PublicShape = import("./library").LibraryShape;
          export type PublicNamespace = typeof import("./namespace");
        `,
        "src/library.ts": `
          export interface LibraryShape { value: string }
          export interface UnusedShape { stale: boolean }
        `,
        "src/namespace.ts": "export interface NamespaceShape { value: string }",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);
    const unusedExportNames = result.unusedExports.map((unusedExport) => unusedExport.name);

    expect(unusedFilePaths).not.toContain("src/library.ts");
    expect(unusedFilePaths).not.toContain("src/namespace.ts");
    expect(unusedExportNames).not.toContain("LibraryShape");
    expect(unusedExportNames).not.toContain("NamespaceShape");
    expect(unusedExportNames).toContain("UnusedShape");
    expect(result.circularDependencies).toEqual([]);
  });

  it("tracks namespace members without treating type-only edges as runtime cycles", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import * as library from "./library";
          import type { TypeA } from "./type-a";
          const value: TypeA | undefined = undefined;
          console.log(library.used, value);
        `,
        "src/library.ts": `
          export const used = 1;
          export const unused = 2;
        `,
        "src/type-a.ts": `
          import type { TypeB } from "./type-b";
          export interface TypeA { child: TypeB }
        `,
        "src/type-b.ts": `
          import type { TypeA } from "./type-a";
          export interface TypeB { parent: TypeA }
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedExports).toEqual([
      expect.objectContaining({ name: "unused", isTypeOnly: false }),
    ]);
    expect(result.circularDependencies).toEqual([]);
  });

  it("does not treat type-only re-exports as runtime cycle edges", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          export const registry = 1;
          export type { Handler } from "./handler";
          export { type HandlerOptions } from "./handler";
        `,
        "src/handler.ts": `
          import { registry } from "./index";
          export interface Handler { registry: typeof registry }
          export interface HandlerOptions { enabled: boolean }
          export const registeredValue = registry;
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toEqual([]);
  });

  it("keeps a mixed value and type re-export edge in runtime cycles", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          export const registry = 1;
          export { registeredValue, type Handler } from "./handler";
        `,
        "src/handler.ts": `
          import { registry } from "./index";
          export interface Handler { registry: typeof registry }
          export const registeredValue = registry;
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toHaveLength(1);
  });

  it("reports cycles formed by side-effect imports", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": 'import "./cycle-a";',
        "src/cycle-a.ts": 'import "./cycle-b";',
        "src/cycle-b.ts": 'import "./cycle-a";',
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toEqual([
      expect.objectContaining({
        files: expect.any(Array),
      }),
    ]);
    expect(
      result.circularDependencies[0]?.files.map((filePath) =>
        relativePath(rootDirectory, filePath),
      ),
    ).toEqual(expect.arrayContaining(["src/cycle-a.ts", "src/cycle-b.ts"]));
  });

  it("links named, default, namespace, dynamic, and chained re-exports", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import defaultValue, { namedValue } from "./barrel";
          import * as namespace from "./namespace";
          void import("./dynamic").then((module) => module.dynamicValue);
          console.log(defaultValue, namedValue, namespace.usedValue);
        `,
        "src/barrel.ts": `
          export { default, namedValue, unusedValue } from "./leaf";
        `,
        "src/leaf.ts": `
          export default 1;
          export const namedValue = 2;
          export const unusedValue = 3;
        `,
        "src/namespace.ts": `
          export const usedValue = 1;
          export const unusedNamespaceValue = 2;
        `,
        "src/dynamic.ts": `
          export const dynamicValue = 1;
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);
    const unusedExportNames = result.unusedExports.map((unusedExport) => unusedExport.name);

    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining([
        "src/barrel.ts",
        "src/leaf.ts",
        "src/namespace.ts",
        "src/dynamic.ts",
      ]),
    );
    expect(unusedExportNames).toEqual(
      expect.arrayContaining(["unusedValue", "unusedNamespaceValue"]),
    );
    expect(unusedExportNames).not.toEqual(
      expect.arrayContaining(["default", "namedValue", "usedValue", "dynamicValue"]),
    );
  });

  it("resolves tsconfig path aliases", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import { aliasedValue } from "@app/value";
          console.log(aliasedValue);
        `,
        "src/lib/value.ts": "export const aliasedValue = 1;",
        "src/lib/orphan.ts": "export const orphan = 1;",
        "tsconfig.json": JSON.stringify({
          compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/lib/*"] } },
        }),
      },
      {},
    );

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/index.ts"],
      tsConfigPath: path.join(rootDirectory, "tsconfig.json"),
    });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/lib/orphan.ts");
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/lib/value.ts");
  });

  it("parses JSONC tsconfig build directories without rewriting string contents", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const publicValue = 1;",
        "src/orphan.ts": "export const orphan = 1;",
        "tsconfig.json": `{
          // Build output maps back to authored sources.
          "compilerOptions": {
            "outDir": "dist",
            "rootDir": "src",
            "sourceRoot": "https://example.com/source",
          },
        }`,
      },
      { main: "dist/index.js" },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).not.toContain("src/index.ts");
    expect(unusedFilePaths).toContain("src/orphan.ts");
  });

  it("discovers config and test entries without explicit patterns", async () => {
    const rootDirectory = createProject(
      {
        "src/main.ts": "console.log('app');",
        "src/vite-plugin.ts": "export const plugin = {};",
        "src/test-helper.ts": "export const helper = 1;",
        "src/orphan.ts": "export const orphan = 1;",
        "vite.config.ts": `
          import { plugin } from "./src/vite-plugin";
          export default { plugins: [plugin] };
        `,
        "tests/app.test.ts": `
          import { helper } from "../src/test-helper";
          console.log(helper);
        `,
      },
      { devDependencies: { vite: "1.0.0", vitest: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["src/vite-plugin.ts", "src/test-helper.ts"]),
    );
  });

  it("discovers framework route entries", async () => {
    const rootDirectory = createProject(
      {
        "src/pages/index.tsx": `
          import { pageValue } from "../page-value";
          export default () => <main>{pageValue}</main>;
        `,
        "src/page-value.ts": "export const pageValue = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { next: "1.0.0", react: "1.0.0", "react-dom": "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toContain("src/page-value.ts");
  });

  it.each([
    { frameworkDependency: "umi", routeConfigPath: "config/routes.ts" },
    { frameworkDependency: "@umijs/max", routeConfigPath: "config/routes.simple.ts" },
  ])(
    "discovers $frameworkDependency application and route convention entries",
    async ({ frameworkDependency, routeConfigPath }) => {
      const rootDirectory = createProject(
        {
          "config/config.ts": `export default { title: "application" };`,
          "config/config.dev.ts": `import { configValue } from "../src/config-value"; export default { configValue };`,
          [routeConfigPath]: `import { routeValue } from "../src/route-value"; export default [{ path: "/", component: routeValue }];`,
          "src/app.tsx": `import { appValue } from "./app-value"; export const render = () => appValue;`,
          "src/app-value.ts": "export const appValue = 1;",
          "src/config-value.ts": "export const configValue = 1;",
          "src/locales/en-US.ts": `import { localeValue } from "../locale-value"; export default localeValue;`,
          "src/locale-value.ts": "export const localeValue = { title: 'application' };",
          "src/pages/index.tsx": `import { pageValue } from "../page-value"; export default () => <main>{pageValue}</main>;`,
          "src/page-value.ts": "export const pageValue = 1;",
          "src/route-value.ts": "export const routeValue = '@/pages/index';",
          "src/orphan.ts": "export const orphan = 1;",
        },
        { dependencies: { [frameworkDependency]: "1.0.0", react: "1.0.0" } },
      );

      const result = await analyzeProject({ rootDirectory });

      expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
    },
  );

  it("discovers Umi runtime, mock, and enabled DVA model conventions", async () => {
    const rootDirectory = createProject(
      {
        "config/config.ts": "export default { dva: { hmr: true } };",
        "src/global.tsx": 'import "./global-value";',
        "src/global-value.ts": "export const globalValue = true;",
        "src/loading.tsx": "export default () => null;",
        "mock/users.ts": 'import "../src/mock-value"; export default {};',
        "src/mock-value.ts": "export const mockValue = true;",
        "src/models/session.ts": 'import "../model-value"; export default {};',
        "src/model-value.ts": "export const modelValue = true;",
        "src/orphan.ts": "export const orphan = true;",
      },
      { dependencies: { react: "1.0.0", umi: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("keeps Umi models authored when DVA is only mentioned in comments", async () => {
    const rootDirectory = createProject(
      {
        "config/config.ts": "// dva: { hmr: true }\nexport default {};",
        "src/pages/index.tsx": "export default () => null;",
        "src/models/manual.ts": "export const manual = true;",
      },
      { dependencies: { react: "1.0.0", umi: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/models/manual.ts");
  });

  it("resolves relative Umi route and loading component contracts", async () => {
    const rootDirectory = createProject(
      {
        "config/config.js": `export default {
          dynamicImport: { loadingComponent: "./components/PageLoading" },
        };`,
        "config/router.config.js": `export default [
          { component: "../layouts/BasicLayout" },
          { component: "./Dashboard/Home" },
        ];`,
        "src/components/PageLoading.tsx": "export default () => null;",
        "src/layouts/BasicLayout.tsx": "export default () => null;",
        "src/pages/Dashboard/Home.tsx": "export default () => null;",
        "src/orphan.ts": "export const orphan = true;",
      },
      { dependencies: { react: "1.0.0", umi: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("discovers gulpfiles only when package scripts invoke Gulp", async () => {
    const invokedRootDirectory = createProject(
      {
        "src/index.ts": "export const application = true;",
        "gulpfile.js": 'import "./tasks/build";',
        "tasks/build.js": "export const build = true;",
      },
      { scripts: { build: "gulp compile" }, devDependencies: { gulp: "1.0.0" } },
    );
    const dormantRootDirectory = createProject(
      {
        "src/index.ts": "export const application = true;",
        "gulpfile.js": "export const dormant = true;",
      },
      { devDependencies: { gulp: "1.0.0" } },
    );

    const invokedResult = await analyzeProject({ rootDirectory: invokedRootDirectory });
    const dormantResult = await analyzeProject({ rootDirectory: dormantRootDirectory });

    expect(relativePaths(invokedRootDirectory, invokedResult.unusedFiles)).toEqual([]);
    expect(relativePaths(dormantRootDirectory, dormantResult.unusedFiles)).toContain("gulpfile.js");
  });

  it("discovers entry points from nested Angular project configuration", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const application = true;",
        "examples/angular/angular.json": JSON.stringify({
          projects: {
            demo: {
              architect: {
                build: { options: { main: "src/main.ts" } },
              },
            },
          },
        }),
        "examples/angular/src/main.ts": 'import "./app";',
        "examples/angular/src/app.ts": "export const app = true;",
        "examples/angular/src/orphan.ts": "export const orphan = true;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "examples/angular/src/orphan.ts",
    ]);
  });

  it("discovers Jasmine spec and fixture conventions", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const application = true;",
        "spec/component-spec.jsx": 'import fixture from "./fixtures/user"; console.log(fixture);',
        "spec/fixtures/user.js": "export default { name: 'Ada' };",
        "src/manual-spec.jsx": "export const manual = true;",
        "src/orphan.jsx": "export const orphan = true;",
      },
      { devDependencies: { "jasmine-tagged": "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.jsx"]);
  });

  it("discovers static entries from CoffeeScript interpolated require factories", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const application = true;",
        "src/registry.coffee": `
          class Registry
            @load = (name, modulePath) ->
              require "../components/#{modulePath}"
            @load "Menu", "menu"
          # @load "Dormant", "dormant"
          # require "../components/dormant"
          active = true # require "../components/dormant"
          require "../components/static"
        `,
        "components/menu.jsx": 'import "./menu-value"; export default () => null;',
        "components/menu-value.ts": "export const menuValue = true;",
        "components/static.jsx": "export default () => null;",
        "components/dormant.jsx": "export default () => null;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["components/dormant.jsx"]);
  });

  it("discovers unique extensionless filename registry arguments", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          registerStore("FeatureUsageStore", "feature-usage-store");
          registerStore("AmbiguousStore", "ambiguous-store");
        `,
        "src/stores/feature-usage-store.ts": "export const store = true;",
        "src/first/ambiguous-store.ts": "export const first = true;",
        "src/second/ambiguous-store.ts": "export const second = true;",
        "src/unrelated-store.ts": "export const unrelated = true;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/first/ambiguous-store.ts",
      "src/second/ambiguous-store.ts",
      "src/unrelated-store.ts",
    ]);
  });

  it("discovers imports from extensionless package script executables", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const application = true;",
        "script/task": `#!/usr/bin/env node\nconst helper = require("./helper"); helper();`,
        "script/helper.js": "module.exports = () => true;",
        "script/orphan.js": "module.exports = () => false;",
      },
      { scripts: { build: "script/task build" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["script/orphan.js"]);
  });

  it("discovers renderer scripts from Electron static index HTML", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const main = true;",
        "static/index.html": '<script src="index.js"></script>',
        "static/index.js": "export const renderer = true;",
        "static/orphan.js": "export const orphan = true;",
      },
      { dependencies: { electron: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["static/orphan.js"]);
  });

  it("discovers source directories consumed through runtime enumeration and copying", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          const extensionsPath = path.join(rootDirectory, "src", "extensions");
          fs.readdirSync(extensionsPath).forEach(filePath => require(filePath));
          const templatePath = path.join(rootDirectory, "static", "template");
          fs.copySync(templatePath, outputPath);
          const cwdAssetsPath = path.resolve(process.cwd(), "src", "cwd-assets");
          fs.readdirSync(cwdAssetsPath);
          const dormantPath = path.join(rootDirectory, "src", "dormant");
          console.log(dormantPath);
          const uncertainPath = path.join(options.directory, "src", "uncertain");
          fs.readdirSync(uncertainPath);
        `,
        "src/extensions/logger.ts": "export default class Logger {}",
        "static/template/main.ts": "export const template = true;",
        "src/cwd-assets/main.ts": "export const cwdAsset = true;",
        "src/dormant/manual.ts": "export const manual = true;",
        "src/uncertain/manual.ts": "export const uncertain = true;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/dormant/manual.ts",
      "src/uncertain/manual.ts",
    ]);
  });

  it("discovers Taro application, config, and page convention entries", async () => {
    const rootDirectory = createProject(
      {
        "config/index.ts": `import developmentConfig from "./dev"; export default developmentConfig;`,
        "config/dev.ts": "export default { env: 'development' };",
        "src/app.tsx": `import { appValue } from "./app-value"; export default () => appValue;`,
        "src/app.config.ts": `
          export default defineAppConfig({
            pages: ["pages/home/index"],
            subPackages: [{ root: "package-a", pages: ["profile/index"] }],
          });
        `,
        "src/app-value.ts": "export const appValue = 1;",
        "src/pages/home/index.tsx": `import { pageValue } from "../../lib/page-value"; export default () => <main>{pageValue}</main>;`,
        "src/pages/home/old-unused.ts": "export const oldUnused = 1;",
        "src/package-a/profile/index.tsx": "export default () => <main>Profile</main>;",
        "src/package-a/profile/old-unused.ts": "export const oldUnused = 1;",
        "src/lib/page-value.ts": "export const pageValue = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {
        dependencies: {
          "@tarojs/cli": "1.0.0",
          "@tarojs/react": "1.0.0",
          "@tarojs/runtime": "1.0.0",
          react: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/orphan.ts",
      "src/package-a/profile/old-unused.ts",
      "src/pages/home/old-unused.ts",
    ]);
  });

  it("discovers Taro pages from identifier-bound application config", async () => {
    const rootDirectory = createProject(
      {
        "src/app.tsx": "export default () => null;",
        "src/app.config.ts": `
          const appConfig = defineAppConfig({ pages: ["pages/home/index"] });
          export default appConfig;
        `,
        "src/pages/home/index.tsx": "export default () => null;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("discovers Taro pages through conditional array calls and pushed subpackages", async () => {
    const rootDirectory = createProject(
      {
        "src/app.tsx": "export default () => null;",
        "src/app.config.ts": `
          const pages = ["pages/home/index", "pages/about/index"];
          const subpackages = [{ root: "package-a", pages: ["profile/index"] }];
          if (process.env.TARO_ENV === "rn") {
            subpackages.push({ root: "package-b", pages: ["settings/index"] });
          }
          export default {
            pages: process.env.TARO_ENV === "rn" ? pages : pages.splice(1),
            subpackages,
          };
        `,
        "src/pages/home/index.tsx": "export default () => null;",
        "src/pages/about/index.tsx": "export default () => null;",
        "src/package-a/profile/index.tsx": "export default () => null;",
        "src/package-b/settings/index.tsx": "export default () => null;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("ignores commented and unrelated route-shaped strings in Taro config", async () => {
    const rootDirectory = createProject(
      {
        "src/app.tsx": "export default () => null;",
        "src/app.config.ts": `
          const pages = ["pages/home/index"];
          if (process.env.TARO_ENV === "rn") {
            pages.push("pages/native/index");
          }
          // pages.push("pages/commented/index");
          const metadata = {
            preview: "pages/metadata/index",
            examples: ["pages/examples/index"],
          };
          export default {
            pages,
            metadata,
            tabBar: { list: [{ pagePath: "pages/home/index" }] },
          };
        `,
        "src/pages/home/index.tsx": "export default () => null;",
        "src/pages/native/index.tsx": "export default () => null;",
        "src/pages/commented/index.tsx": "export default () => null;",
        "src/pages/metadata/index.tsx": "export default () => null;",
        "src/pages/examples/index.tsx": "export default () => null;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/pages/commented/index.tsx",
      "src/pages/examples/index.tsx",
      "src/pages/metadata/index.tsx",
    ]);
  });

  it("discovers Remix routes from a custom app directory", async () => {
    const rootDirectory = createProject(
      {
        "remix.config.js": `module.exports = { appDirectory: "src" };`,
        "src/root.tsx": `import { routeValue } from "./routes/index"; export default () => <main>{routeValue}</main>;`,
        "src/routes/index.tsx": "export const routeValue = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { "@remix-run/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["src/root.tsx", "src/routes/index.tsx"]),
    );
  });

  it("discovers GraphQL codegen inputs", async () => {
    const rootDirectory = createProject(
      {
        "codegen-main.ts": `
          export default {
            schema: "./schema.graphql",
            // documents: ["./src/commented.ts"],
            documents: ["./src/**/queries.ts", "!./src/legacy/**"],
          };
        `,
        "schema.graphql": "type Query { value: String }",
        "src/commented.ts": "export const commented = true;",
        "src/feature/queries.ts": `import { helper } from "../helper"; export const query = \`query { value }\`; console.log(helper);`,
        "src/helper.ts": "export const helper = 1;",
        "src/legacy/queries.ts": "export const legacyQuery = `query { value }`;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/legacy/queries.ts");
    expect(unusedFilePaths).toContain("src/commented.ts");
    expect(unusedFilePaths).toContain("src/helper.ts");
    expect(unusedFilePaths).not.toContain("src/feature/queries.ts");
    expect(result.unusedExports).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "query" })]),
    );
  });

  it("discovers YAML block-list codegen inputs without activating comments", async () => {
    const rootDirectory = createProject(
      {
        "codegen.yml": `
          schema:
            - "./src/schema-loader.ts"
          documents:
            - "./src/documents/**/*.ts" # active documents
            - "!./src/documents/excluded/**"
            # - "./src/commented-list-item/**/*.ts"
          # documents:
          #   - "./src/commented-property/**/*.ts"
        `,
        "src/schema-loader.ts": `import { schemaHelper } from "./schema-helper"; export default schemaHelper;`,
        "src/schema-helper.ts": "export const schemaHelper = {};",
        "src/documents/query.ts": `import { documentHelper } from "../document-helper"; export const query = \`query { value }\`; console.log(documentHelper);`,
        "src/document-helper.ts": "export const documentHelper = 1;",
        "src/documents/excluded/legacy.ts": "export const legacyQuery = `query { legacy }`;",
        "src/commented-list-item/query.ts": "export const commentedListItemQuery = 1;",
        "src/commented-property/query.ts": "export const commentedPropertyQuery = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["src/schema-loader.ts", "src/schema-helper.ts"]),
    );
    expect(unusedFilePaths).not.toContain("src/documents/query.ts");
    expect(unusedFilePaths).toEqual(
      expect.arrayContaining([
        "src/document-helper.ts",
        "src/documents/excluded/legacy.ts",
        "src/commented-list-item/query.ts",
        "src/commented-property/query.ts",
      ]),
    );
    expect(result.unusedExports).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "query" })]),
    );
  });

  it("keeps GraphQL codegen outputs in the graph without reporting them", async () => {
    const rootDirectory = createProject(
      {
        "codegen.ts": `
          export default {
            schema: "./schema.graphql",
            generates: {
              "./src/api-types.ts": { plugins: ["typescript"] },
            },
          };
        `,
        "schema.graphql": "type Query { value: String }",
        "src/index.ts": `import { usedType } from "./api-types"; console.log(usedType);`,
        "src/api-types.ts": `export const usedType = 1; export interface GeneratedShape { value: string }`,
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
    expect(result.unusedExports).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "GeneratedShape" })]),
    );
  });

  it("discovers GraphQL codegen outputs from one-line JavaScript objects", async () => {
    const rootDirectory = createProject(
      {
        "codegen.ts": `export default { generates: { /* output map { */ "./src/api-runtime.ts": { config: { "./src/not-an-output.ts": true }, plugins: ["typescript"] } } };`,
        "src/index.ts": "console.log('app');",
        "src/api-runtime.ts": "export const apiRuntime = 1;",
        "src/not-an-output.ts": "export const notAnOutput = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/not-an-output.ts",
      "src/orphan.ts",
    ]);
  });

  it("discovers GraphQL codegen outputs from graphqlrc and the Vite codegen plugin", async () => {
    const rootDirectory = createProject(
      {
        ".graphqlrc.yml": `generates:\n  ./src/gql/:\n    preset: client`,
        "vite.config.ts": `
          import graphqlCodegen from "vite-plugin-graphql-codegen";
          export default { plugins: [graphqlCodegen({ generates: { "./src/vite-gql/": { preset: "client" } } })] };
        `,
        "src/index.ts": "console.log('app');",
        "src/gql/graphql.ts": "export interface GraphqlOutput { value: string }",
        "src/vite-gql/graphql.ts": "export interface ViteGraphqlOutput { value: string }",
        "src/authored/graphql.ts": "export interface AuthoredGraphqlShape { value: string }",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/authored/graphql.ts"]);
    expect(result.unusedExports).toEqual([]);
  });

  it("recognizes explicit generated-via provenance only in leading comments", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "src/api.ts":
          "/* THIS FILE WAS GENERATED VIA SWAGGER-TYPESCRIPT-API */\nexport interface ApiShape { value: string }",
        "src/manual.ts":
          "export interface ManualShape { value: string }\n/* generated via a test example */",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/manual.ts"]);
  });

  it("does not discover GraphQL codegen outputs from strings or comments", async () => {
    const rootDirectory = createProject(
      {
        "codegen.ts": `
          const example = 'generates: { "./src/string-decoy.ts": {} }';
          const enabled = true; // generates: { "./src/comment-decoy.ts": {} }
          export default { generates: { "./src/api-runtime.ts": {} } };
        `,
        "src/index.ts": "console.log('app');",
        "src/api-runtime.ts": "export const apiRuntime = 1;",
        "src/string-decoy.ts": "export const stringDecoy = 1;",
        "src/comment-decoy.ts": "export const commentDecoy = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/comment-decoy.ts",
      "src/orphan.ts",
      "src/string-decoy.ts",
    ]);
  });

  it("suppresses provenance-backed outputs without inferring generation from type shapes", async () => {
    const rootDirectory = createProject(
      {
        "codegen.yml": `
          schema: schema.graphql
          generates:
            src/api-client.ts:
              plugins:
                - typescript
        `,
        "schema.graphql": "type Query { value: String }",
        "src/index.ts": "console.log('app');",
        "src/generated/schema.ts": "export interface GeneratedDirectoryShape { value: string }",
        "src/schema.generated.ts": "export interface GeneratedFilenameShape { value: string }",
        "src/protocol.ts":
          "// @generated by protocol compiler\nexport interface GeneratedHeaderShape { value: string }",
        "src/graphql-types.ts":
          "export type Maybe<T> = T | null; export type Exact<T> = T; export interface GeneratedGraphqlShape { value: string }",
        "src/apollo-types.ts":
          "export type QueryKeySpecifier = ['query']; export type QueryFieldPolicy = { read(): unknown };",
        "src/codegen-types.ts": [
          "export type Maybe<T> = T | null;",
          "export type Exact<T extends { [key: string]: unknown }> = { [K in keyof T]: T[K] };",
          "export type MakeOptional<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]?: Maybe<T[SubKey]> };",
          "export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & { [SubKey in K]: Maybe<T[SubKey]> };",
          "export type Scalars = { ID: string };",
        ].join("\n"),
        "src/apollo-helpers.ts": [
          'import { type FieldPolicy, type FieldReadFunction, type TypePolicies, type TypePolicy } from "@apollo/client/cache";',
          'export type QueryKeySpecifier = ("viewer" | QueryKeySpecifier)[];',
          "export type QueryFieldPolicy = { viewer?: FieldPolicy<unknown> | FieldReadFunction<unknown> };",
          "export type TypedTypePolicies = TypePolicies & { Query?: Omit<TypePolicy, 'fields'> };",
        ].join("\n"),
        "src/authored-apollo-policy.ts": [
          'import { type FieldPolicy, type TypePolicies } from "@apollo/client/cache";',
          "export type QueryFieldPolicy = { viewer?: FieldPolicy<unknown> };",
          "export type ApplicationPolicies = TypePolicies;",
        ].join("\n"),
        "src/protocol.h.ts": "export interface HandWrittenProtocol { value: string }",
        "src/late-generated-marker.ts":
          "export const handWritten = true;\n// This example was generated by a test helper.",
        "src/do-not-edit.ts":
          "// Do not edit this file directly; use the admin UI.\nexport const handWritten = true;",
        "src/api-client.ts": "export interface GeneratedConfigShape { value: string }",
        "src/__testfixtures__/parser-output.ts": "export const fixture = 1;",
        "src/vendor/library.ts": "export const vendored = 1;",
        "src/assets/libs/runtime.ts": "export const staticRuntime = 1;",
        "src/button.figma.tsx": "export const codeConnectExample = 1;",
        "src/legacy-sdk/README.md": "legacy-sdk is an in-progress migration of another package.",
        "src/legacy-sdk/types.ts": "export interface MigratedPackageShape { value: string }",
        "public/runtime.ts": "export const publicRuntime = 1;",
        "src/public/manual.ts": "export const manuallyOwned = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/apollo-types.ts",
      "src/authored-apollo-policy.ts",
      "src/do-not-edit.ts",
      "src/graphql-types.ts",
      "src/late-generated-marker.ts",
      "src/legacy-sdk/types.ts",
      "src/orphan.ts",
      "src/protocol.h.ts",
      "src/public/manual.ts",
    ]);
    expect(result.unusedExports).toEqual([]);
  });

  it("resolves Vite HTML entries from the configured root", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.mts": `
          import { join } from "node:path";
          const rendererRoot = join(__dirname, "src", "renderer");
          export default {
            root: rendererRoot,
            build: { rollupOptions: { input: { search: join(rendererRoot, "search.html") } } },
          };
        `,
        "src/renderer/search.html": `<script type="module" src="/search.tsx"></script>`,
        "src/renderer/search.tsx": `import { Search } from "./search"; console.log(Search);`,
        "src/renderer/search.ts": "export const Search = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("resolves unquoted Vite HTML entries with query strings", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `export default {};`,
        "index.html": `<script type=module src=/src/main.ts?v=1></script>`,
        "src/main.ts": `import { value } from "./value"; console.log(value);`,
        "src/value.ts": "export const value = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("resolves a Vite callback root without selecting nested test roots", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.mts": `
          import { join } from "node:path";
          import { defineConfig } from "vite";
          const rendererRoot = join(__dirname, "src", "renderer");
          export default defineConfig(() => ({
            root: rendererRoot,
            test: { root: "src" },
          }));
        `,
        "src/renderer/index.html": `<script type="module" src="/main.ts"></script>`,
        "src/renderer/main.ts": `import { app } from "./app"; console.log(app);`,
        "src/renderer/app.ts": "export const app = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("expands project-root import.meta.glob patterns", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `const previews = import.meta.glob("/src/previews/**/*.tsx"); console.log(previews);`,
        "src/previews/button/index.tsx": "export default () => null;",
        "src/previews/dialog/index.tsx": "export default () => null;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("expands static template-literal import.meta.glob patterns", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "import './registry';",
        "src/registry.ts": "export const pages = import.meta.glob(`/src/pages/**/loading.tsx`);",
        "src/pages/loading.tsx": "export default () => null;",
        "src/orphan.ts": "export const orphan = true;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("binds project-root Vite globs to the owning root across workspaces", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": "export default {};",
        "index.html": `<script type="module" src="/src/main.ts"></script>`,
        "src/main.ts": `import { previews } from "../packages/library/glob"; console.log(previews);`,
        "src/previews/root.tsx": "export default () => null;",
        "packages/library/package.json": JSON.stringify({ name: "@example/library" }),
        "packages/library/glob.ts":
          'export const previews = import.meta.glob("/src/previews/**/*.tsx");',
        "packages/library/src/previews/workspace.tsx": "export default () => null;",
      },
      { private: true, workspaces: ["packages/*"], devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain(
      "packages/library/src/previews/workspace.tsx",
    );
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/previews/root.tsx");
  });

  it("uses a custom Vite root for globs imported from sibling source", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `export default { root: "app" };`,
        "app/index.html": `<script type="module" src="/main.ts"></script>`,
        "app/main.ts": `import { previews } from "../shared/glob"; console.log(previews);`,
        "app/src/previews/application.tsx": "export default () => null;",
        "shared/glob.ts": 'export const previews = import.meta.glob("/src/previews/**/*.tsx");',
        "shared/src/previews/shared.tsx": "export default () => null;",
        "src/previews/project.tsx": "export default () => null;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "shared/src/previews/shared.tsx",
      "src/previews/project.tsx",
    ]);
  });

  it("resolves SvelteKit aliases before expanding project-root globs", async () => {
    const rootDirectory = createProject(
      {
        "svelte.config.js": `export default { kit: { alias: { $docs: "src/docs" } } };`,
        "src/routes/+page.ts": `import { previews } from "$docs/preview.js"; console.log(previews);`,
        "src/docs/preview.ts": `export const previews = import.meta.glob("/src/previews/**/*.svelte");`,
        "src/previews/button/index.svelte": "<main>Button</main>",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { "@sveltejs/kit": "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("extracts live MDX imports without parsing fenced examples as module syntax", async () => {
    const rootDirectory = createProject(
      {
        "src/app/components/page.mdx": [
          "# Component",
          "",
          "```tsx",
          "export function IncompleteExample(",
          "```",
          "",
          'import { Demo } from "./demos/example";',
          "",
          "<Demo />",
        ].join("\n"),
        "src/app/components/demos/example/index.ts": `export { Demo } from "./render";`,
        "src/app/components/demos/example/render.tsx":
          "export const Demo = () => <main>Demo</main>;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { dependencies: { next: "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
    expect(result.analysisErrors).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "parse-recovered-partial" })]),
    );
  });

  it("resolves Webpack v1 entries from the project root", async () => {
    const rootDirectory = createProject(
      {
        "webpack/prod/webpack.config.js": `
          const commonResolve = { modulesDirectories: ["shared", "node_modules"] };
          module.exports = { entry: { app: ["./lib/client/app.js"] }, resolve: commonResolve };
        `,
        "lib/client/app.js": `import { screen } from "screens/home"; console.log(screen);`,
        "lib/shared/screens/home.js": "export const screen = 1;",
        "lib/orphan.js": "export const orphan = 1;",
      },
      { devDependencies: { webpack: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["lib/orphan.js"]);
  });

  it("discovers computed entries in imported Webpack configuration modules", async () => {
    const rootDirectory = createProject(
      {
        "webpack.config.ts": `import adminConfig from "./webpack-configs/admin"; export default adminConfig;`,
        "webpack-configs/admin.ts": `
          import PathUtil from "../scripts/path-util";
          export default { entry: PathUtil.admin("index") };
        `,
        "scripts/path-util.ts": "export default {};",
        "src/admin/index.tsx": `import "./main.scss"; export const Admin = () => null;`,
        "src/admin/main.scss": "$color: red;",
      },
      { devDependencies: { webpack: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/admin/index.tsx");
  });

  it("resolves Webpack path helpers relative to the configuration module", async () => {
    const rootDirectory = createProject(
      {
        "webpack.config.ts": `
          import path from "node:path";
          export default { entry: path.join("src", "index.ts") };
        `,
        "src/index.ts": "export const application = true;",
        "src/orphan.ts": "export const orphan = true;",
      },
      { devDependencies: { webpack: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("does not infer computed Webpack entries from arbitrary helpers", async () => {
    const rootDirectory = createProject(
      {
        "webpack.config.ts": `
          const Routes = { admin: (name) => "/admin/" + name };
          export default { entry: Routes.admin("index") };
        `,
        "src/admin/index.tsx": "export const Admin = () => null;",
      },
      { devDependencies: { webpack: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/admin/index.tsx");
  });

  it("uses only the top-level Vite root and resolves direct path calls", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          import { resolve } from "node:path";
          // root: "./wrong-root",
          export default {
            plugins: [{ options: { root: "./wrong-root" } }],
            root: resolve(__dirname, "src", "renderer"),
          };
        `,
        "src/renderer/index.html": `<script type="module" src="/main.ts"></script>`,
        "src/renderer/main.ts": `import { application } from "./application"; console.log(application);`,
        "src/renderer/application.ts": "export const application = 1;",
        "wrong-root/index.html": `<script type="module" src="/unused.ts"></script>`,
        "wrong-root/unused.ts": "export const unused = 1;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("wrong-root/unused.ts");
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toEqual(
      expect.arrayContaining(["src/renderer/main.ts", "src/renderer/application.ts"]),
    );
  });

  it("discovers Electron Forge renderer entry points", async () => {
    const rootDirectory = createProject(
      {
        "forge.config.ts": `
          export default {
            plugins: [{ renderer: { entryPoints: [{
              html: "./src/renderer/index.html",
              js: "./src/renderer/index.tsx",
              preload: { js: "./src/preload.ts" },
            }] } }],
          };
        `,
        "src/renderer/index.html": "<main></main>",
        "src/renderer/index.tsx": `import { application } from "./application"; console.log(application);`,
        "src/renderer/application.ts": "export const application = 1;",
        "src/preload.ts": "console.log('preload');",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { "@electron-forge/cli": "1.0.0", electron: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("discovers Vitest includes declared in Vite config", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          export default {
            test: {
              include: ["**/*_{test,spec}.?(c|m)[jt]s?(x)"],
              coverage: { include: ["src/**"] },
            },
          };
        `,
        "test/component_test.tsx": `import { component } from "../src/component"; console.log(component);`,
        "src/component.ts": "export const component = 1;",
        "src/coverage-only.ts": "export const coverageOnly = 1;",
      },
      { devDependencies: { vitest: "1.0.0", vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/coverage-only.ts"]);
  });

  it("discovers Vitest includes after astral Unicode", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          const label = "😀";
          export default { test: { include: ["cases/**/*.case.ts"] } };
        `,
        "src/index.ts": "console.log('app');",
        "cases/actual.case.ts": "export const actualCase = true;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      { devDependencies: { vite: "1.0.0", vitest: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("does not treat the array after a Vitest include variable as the include value", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          const testFiles = ["test/**/*.case.ts"];
          export default {
            test: {
              include: testFiles,
              exclude: ["src/ignored.ts"],
            },
          };
        `,
        "src/index.ts": "console.log('app');",
        "src/ignored.ts": "export const ignored = 1;",
      },
      { devDependencies: { vite: "1.0.0", vitest: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/ignored.ts"]);
  });

  it("does not treat Vite plugin include filters as Vitest entries", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          /* test: { */
          export default {
            plugins: [{ include: ["src/plugin-filtered.ts"] }],
          };
        `,
        "src/index.ts": "console.log('app');",
        "src/plugin-filtered.ts": "export const pluginFiltered = 1;",
      },
      { devDependencies: { vite: "1.0.0", vitest: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/plugin-filtered.ts"]);
  });

  it("discovers externally consumed component composition registries", async () => {
    const rootDirectory = createProject(
      { "src/composition.tsx": "export const Composition = () => <main />;" },
      {
        private: "true",
        description: "Registry for component compositions",
        dependencies: { react: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/composition.tsx");
  });

  it("resolves composition registry entries relative to a workspace package", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const root = 1;",
        "packages/compositions/package.json": JSON.stringify({
          name: "@example/compositions",
          private: true,
          description: "Registry for component compositions",
        }),
        "packages/compositions/src/composition.tsx": "export const Composition = () => <main />;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain(
      "packages/compositions/src/composition.tsx",
    );
  });

  it("resolves extensionless entry fields from implicitly discovered packages", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const root = 1;",
        "internal_packages/composer/package.json": JSON.stringify({
          name: "composer",
          private: true,
          main: "./lib/main",
        }),
        "internal_packages/composer/lib/main.es6":
          'import { View } from "./view"; export const Legacy = View;',
        "internal_packages/composer/lib/view.jsx":
          'import { Legacy } from "./main"; export const View = Legacy;',
        "internal_packages/composer/lib/orphan.jsx": "export const Orphan = () => null;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "internal_packages/composer/lib/orphan.jsx",
    ]);
    expect(result.circularDependencies).toEqual([]);
  });

  it("suppresses public assets at workspace roots without suppressing nested source folders", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const root = 1;",
        "packages/client/package.json": JSON.stringify({
          name: "@example/client",
          devDependencies: { vite: "1.0.0" },
        }),
        "packages/client/src/index.ts": "export const client = 1;",
        "packages/client/public/runtime.ts": "export const publicRuntime = 1;",
        "packages/client/src/public/manual.ts": "export const manuallyOwned = 1;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain(
      "packages/client/src/public/manual.ts",
    );
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain(
      "packages/client/public/runtime.ts",
    );
  });

  it("reports authored public source in library workspaces", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "export const root = 1;",
        "packages/library/package.json": JSON.stringify({
          name: "@example/library",
          exports: "./src/index.ts",
        }),
        "packages/library/src/index.ts": "export const library = 1;",
        "packages/library/public/manual.ts": "export const manual = 1;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain(
      "packages/library/public/manual.ts",
    );
  });

  it("treats package export entries as externally consumed public surfaces", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": 'export * from "./components";',
        "src/components.ts": `
          export const Button = () => null;
          export interface ButtonProps { label: string }
        `,
        "src/internal.ts": "export const internal = true;",
        "src/dormant.ts": "export const dormant = true;",
        "src/app.ts": 'import "./internal"; console.log("app");',
      },
      {
        name: "@example/library",
        exports: { ".": "./src/index.ts" },
        scripts: { start: "tsx src/app.ts" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/dormant.ts");
    expect(result.unusedExports).toEqual([]);
  });

  it("treats nested package export patterns as public surfaces", async () => {
    const rootDirectory = createProject(
      {
        "src/Common/Avatar/Overlay/index.tsx": `
          export interface AvatarOverlayProps { label: string }
          export const AvatarOverlay = (props: AvatarOverlayProps) => props.label;
        `,
      },
      {
        name: "@example/components",
        exports: { "./*": "./src/*" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(result.unusedExports).toEqual([]);
  });

  it("credits bundleless glob entry modules", async () => {
    const rootDirectory = createProject(
      {
        "tsup.config.ts": `export default { entry: ["./src/**/*.{ts,tsx}"] };`,
        "src/index.ts": 'export { publicUtility } from "./utils/public-utility";',
        "src/utils/public-utility.ts": "export const publicUtility = true;",
      },
      {
        name: "@example/bundleless-library",
        scripts: { build: "tsup" },
        exports: { "./*": "./*" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(result.unusedExports).toEqual([]);
  });

  it("resolves imports from TSX with large inline data", async () => {
    const embeddedSvgPath = "M".repeat(MINIFIED_DETECTION_MIN_BYTES);
    const rootDirectory = createProject(
      {
        "app/(demo)/page.tsx": `
          import { ClientPage } from "./page.client";
          export default () => <svg><path d="${embeddedSvgPath}" /><ClientPage /></svg>;
        `,
        "app/(demo)/page.client.tsx": "export const ClientPage = () => null;",
      },
      { dependencies: { next: "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(result.unusedExports).toEqual([]);
  });

  it("resolves package proxies to root-preserving build output", async () => {
    const rootDirectory = createProject(
      {
        "app.plugin.js": 'module.exports = require("./dist/plugins/with-example");',
        "plugins/with-example.ts": "export default () => null;",
        "tsconfig.json": JSON.stringify({ compilerOptions: { outDir: "dist" } }),
      },
      {
        name: "@example/expo-plugin",
        files: ["dist", "app.plugin.js"],
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(result.unusedExports).toEqual([]);
  });

  it("credits modules dynamically loaded by Next config", async () => {
    const rootDirectory = createProject(
      {
        "next.config.mjs": `
          import { createJiti } from "jiti";
          const loadTypeScript = createJiti(import.meta.url);
          const { schema } = await loadTypeScript.import("./src/schema.ts");
          schema.parse({});
          export default {};
        `,
        "src/schema.ts": "export const schema = { parse: (value: unknown) => value };",
      },
      {
        dependencies: { next: "1.0.0", react: "1.0.0", jiti: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(result.unusedExports).toEqual([]);
  });

  it("credits packages referenced by scripts, config, and CI workflows", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "vite.config.ts": `import configPackage from "config-package"; export default configPackage;`,
        ".github/workflows/release.yml": `steps:\n  - run: npx ci-package deploy`,
      },
      {
        scripts: { build: "script-package build" },
        devDependencies: {
          "script-package": "1.0.0",
          "config-package": "1.0.0",
          "ci-package": "1.0.0",
          "unused-package": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toContain("unused-package");
    expect(unusedPackageNames).not.toEqual(
      expect.arrayContaining(["script-package", "config-package", "ci-package"]),
    );
  });

  it("credits package-valued CLI options without accepting unrelated script tokens", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: {
          test: "jest --testResultsProcessor jest-sonar-reporter",
          explain: "echo unused-token-package",
        },
        devDependencies: {
          jest: "1.0.0",
          "jest-sonar-reporter": "1.0.0",
          "unused-token-package": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).not.toContain("jest-sonar-reporter");
    expect(unusedPackageNames).toContain("unused-token-package");
  });

  it("credits binaries invoked by a local shell script without reading shell-script arguments", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "scripts/build.sh": "firebase deploy",
        "scripts/dormant.sh": "unused-shell-package deploy",
      },
      {
        scripts: {
          build: "bash ./scripts/build.sh",
          explain: "echo ./scripts/dormant.sh",
        },
        devDependencies: {
          "firebase-tools": "1.0.0",
          "unused-shell-package": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).not.toContain("firebase-tools");
    expect(unusedPackageNames).toContain("unused-shell-package");
  });

  it("credits framework-owned image and MDX dependencies", async () => {
    const rootDirectory = createProject(
      { "src/index.tsx": "export default () => <main />;" },
      {
        dependencies: {
          react: "1.0.0",
          next: "1.0.0",
          sharp: "1.0.0",
          "@next/mdx": "1.0.0",
          "@mdx-js/loader": "1.0.0",
          "@mdx-js/react": "1.0.0",
          remix: "1.0.0",
          "@remix-run/react": "1.0.0",
          "web-vitals": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.tsx"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toContain("web-vitals");
    expect(unusedPackageNames).not.toEqual(
      expect.arrayContaining(["sharp", "@mdx-js/loader", "@mdx-js/react", "@remix-run/react"]),
    );
  });

  it("credits sharp conservatively when Next image optimization is configured", async () => {
    const rootDirectory = createProject(
      {
        "src/index.tsx": "export default () => <main />;",
        "next.config.js": "module.exports = { images: { unoptimized: true } };",
      },
      { dependencies: { react: "1.0.0", next: "1.0.0", sharp: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.tsx"] });

    expect(result.unusedDependencies).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "sharp" })]),
    );
  });

  it("credits the Docusaurus MDX runtime", async () => {
    const rootDirectory = createProject(
      { "src/index.tsx": "export default () => <main />;" },
      {
        dependencies: {
          react: "1.0.0",
          "@docusaurus/core": "1.0.0",
          "@mdx-js/react": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.tsx"] });

    expect(result.unusedDependencies).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "@mdx-js/react" })]),
    );
  });

  it("follows live imports from Docusaurus Markdown content without treating README examples as code", async () => {
    const rootDirectory = createProject(
      {
        "docs/page.md": `import "../src/player";`,
        "README.md": `import "./src/readme-example";`,
        "src/player.ts": "export const player = true;",
        "src/readme-example.ts": "export const example = true;",
      },
      { dependencies: { "@docusaurus/core": "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/readme-example.ts");
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/player.ts");
  });

  it("honors configured ignores when collecting executable Docusaurus Markdown", async () => {
    const rootDirectory = createProject(
      {
        "docs/ignored/page.md": `import "../../src/ignored-player";`,
        "src/ignored-player.ts": "export const player = true;",
      },
      { dependencies: { "@docusaurus/core": "1.0.0" } },
    );

    const result = await analyzeProject({
      rootDirectory,
      ignorePatterns: ["docs/ignored/**"],
    });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/ignored-player.ts");
  });

  it("credits known binary aliases and release config plugins without guessing wrapper peers", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import Chart from "react-apexcharts"; console.log(Chart);`,
        ".releaserc.json": JSON.stringify({ plugins: ["release-plugin"] }),
      },
      {
        scripts: { build: "babel src --out-dir dist", start: "remix-serve build" },
        release: { plugins: ["release-package-json-plugin"] },
        dependencies: {
          "react-apexcharts": "1.0.0",
          apexcharts: "1.0.0",
        },
        devDependencies: {
          "@babel/cli": "1.0.0",
          "@remix-run/serve": "1.0.0",
          "release-plugin": "1.0.0",
          "release-package-json-plugin": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    for (const usedPackageName of [
      "@babel/cli",
      "@remix-run/serve",
      "release-plugin",
      "release-package-json-plugin",
    ]) {
      expect(unusedPackageNames).not.toContain(usedPackageName);
    }
    expect(unusedPackageNames).toContain("apexcharts");
  });

  it("credits packages named by tool config surfaces", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        ".stylelintrc.json": JSON.stringify({
          plugins: ["stylelint-order", "stylelint-prettier"],
        }),
        "typedoc.json": JSON.stringify({ plugin: ["typedoc-plugin-markdown"] }),
        "netlify.toml": '[[plugins]]\npackage = "@netlify/plugin-nextjs"',
        ".release-it.json": JSON.stringify({
          plugins: { "@release-it/conventional-changelog": {} },
        }),
        "tsconfig.json": JSON.stringify({
          compilerOptions: { plugins: [{ name: "typescript-plugin-css-modules" }] },
        }),
        "styles/globals.css": '@plugin "tailwindcss-animate";',
      },
      {
        "pre-commit": ["lint"],
        devDependencies: {
          "stylelint-order": "1.0.0",
          "stylelint-prettier": "1.0.0",
          "typedoc-plugin-markdown": "1.0.0",
          "@netlify/plugin-nextjs": "1.0.0",
          "typescript-plugin-css-modules": "1.0.0",
          "tailwindcss-animate": "1.0.0",
          "@release-it/conventional-changelog": "1.0.0",
          "pre-commit": "1.0.0",
          "release-it": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual([]);
  });

  it("credits package.json tool owner sections", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        "pre-commit": ["lint"],
        "release-it": {},
        devDependencies: {
          "pre-commit": "1.0.0",
          "release-it": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedDependencies).toEqual([]);
  });

  it("credits stylesheet package directives without matching ordinary stylesheet text", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "styles/globals.scss": `
          /* @plugin "commented-package"; */
          @plugin "tailwindcss-animate";
          @import url(modern-normalize/modern-normalize.css);
          @use "pkg:sass-mq";
          $color: red;
          .swiper-slide { color: $color; }
          .example::before { content: '@plugin "string-package"'; }
        `,
      },
      {
        devDependencies: {
          color: "1.0.0",
          "commented-package": "1.0.0",
          "modern-normalize": "1.0.0",
          "sass-mq": "1.0.0",
          "string-package": "1.0.0",
          swiper: "1.0.0",
          "tailwindcss-animate": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies
      .map((dependency) => dependency.name)
      .sort();

    expect(unusedPackageNames).toEqual(["color", "commented-package", "string-package", "swiper"]);
  });

  it("credits script-implied tools and binary aliases", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "node_modules/openfin-cli/package.json": JSON.stringify({
          bin: { openfin: "dist/cli.js" },
        }),
      },
      {
        scripts: {
          check: "astro check && oxlint --type-aware",
          postinstall: "patch-package",
          email: "email dev",
          serve: "react-router-serve build/server/index.js",
          deploy: 'sh -c "npx cross-env NODE_ENV=production env -u DEBUG firebase deploy"',
          publish: "rc-np",
          rebuild: "electron-rebuild",
          extract: "api-extractor run",
          taro: "taro build",
          chakra: 'bash -lc "chakra tokens src/theme.ts"',
          flow: "flow status",
          parcel: "parcel src/index.html",
          babel: "cross-env BABEL_ENV=production babel src --out-dir dist",
          "babel-node": 'nodemon --exec "babel-node --inspect" server.js',
          openfin:
            'cross-env-shell "wait-on -l $npm_config_manifest_url && openfin -l -c $npm_config_manifest_url"',
          coverage: "node node_modules/coveralls/bin/coveralls.js",
        },
        devDependencies: {
          "@astrojs/check": "1.0.0",
          "oxlint-tsgolint": "1.0.0",
          "postinstall-postinstall": "1.0.0",
          "react-email": "1.0.0",
          "@react-router/serve": "1.0.0",
          "firebase-tools": "1.0.0",
          "@rc-component/np": "1.0.0",
          "@electron/rebuild": "1.0.0",
          "@microsoft/api-extractor": "1.0.0",
          "@tarojs/cli": "1.0.0",
          "@chakra-ui/cli": "1.0.0",
          "flow-bin": "1.0.0",
          "parcel-bundler": "1.0.0",
          "babel-cli": "1.0.0",
          coveralls: "1.0.0",
          "openfin-cli": "1.0.0",
          "wait-on": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual([]);
  });

  it.each([
    "npm exec -- firebase deploy",
    "pnpm exec firebase deploy",
    "yarn exec firebase deploy",
    "pnpm dlx firebase-tools deploy",
    "yarn dlx firebase-tools deploy",
  ])("credits binaries invoked through package-manager runners: $command", async (command) => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: { deploy: command },
        devDependencies: { "firebase-tools": "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedDependencies).toEqual([]);
  });

  it("skips ambiguous static binary providers", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: { build: "babel src --out-dir dist" },
        devDependencies: {
          "@babel/cli": "1.0.0",
          "babel-cli": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    expect(result.unusedDependencies).toEqual([]);
  });

  it("requires a complete node_modules binary name match", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: {
          coverage: "node node_modules/coveralls/bin/coveralls.js",
          tool: "node node_modules/.bin/foobar",
        },
        devDependencies: {
          coveralls: "1.0.0",
          foo: "1.0.0",
          foobar: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(["foo"]);
  });

  it("does not infer wrapper peers without authoritative metadata", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import prettyCode from "rehype-pretty-code";
          import { PrismaClient } from "@prisma/client";
          import ReactRefreshWebpackPlugin from "@pmmmwh/react-refresh-webpack-plugin";
          import { Elements } from "@stripe/react-stripe-js";
          console.log(prettyCode, PrismaClient, ReactRefreshWebpackPlugin, Elements);
        `,
        "prisma/schema.prisma": `generator client { provider = "prisma-client-js" }`,
      },
      {
        dependencies: {
          "rehype-pretty-code": "1.0.0",
          shiki: "1.0.0",
          "@prisma/client": "1.0.0",
          prisma: "1.0.0",
          "@pmmmwh/react-refresh-webpack-plugin": "1.0.0",
          "react-refresh": "1.0.0",
          "@stripe/react-stripe-js": "1.0.0",
          "@stripe/stripe-js": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(
      expect.arrayContaining(["shiki", "react-refresh", "@stripe/stripe-js"]),
    );
    expect(unusedPackageNames).not.toContain("prisma");
  });

  it("does not infer Prisma CLI use from the optional client peer alone", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import { PrismaClient } from "@prisma/client"; console.log(PrismaClient);`,
        "node_modules/@prisma/client/package.json": JSON.stringify({
          name: "@prisma/client",
          version: "1.0.0",
          peerDependencies: { prisma: "*" },
          peerDependenciesMeta: { prisma: { optional: true } },
        }),
      },
      {
        dependencies: {
          "@prisma/client": "1.0.0",
          prisma: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(["prisma"]);
  });

  it("does not infer Prisma CLI use from fixture schemas", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import { PrismaClient } from "@prisma/client"; console.log(PrismaClient);`,
        "test/fixtures/prisma/schema.prisma": `generator client { provider = "prisma-client-js" }`,
      },
      {
        dependencies: {
          "@prisma/client": "1.0.0",
          prisma: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(["prisma"]);
  });

  it("credits native Capacitor platforms without inferring Sass use from an orphan stylesheet", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "src/theme.scss": "$color: red;",
        "capacitor.config.ts": "export default {};",
        "android/.gitkeep": "",
        "ios/.gitkeep": "",
      },
      {
        scripts: { build: "vite build" },
        dependencies: {
          "@capacitor/core": "1.0.0",
          "@capacitor/android": "1.0.0",
          "@capacitor/ios": "1.0.0",
          vite: "1.0.0",
          "sass-embedded": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    for (const usedPackageName of ["@capacitor/android", "@capacitor/ios"]) {
      expect(unusedPackageNames).not.toContain(usedPackageName);
    }
    expect(unusedPackageNames).toContain("sass-embedded");
  });

  it("uses Sass Embedded before Sass when an observed host can compile Sass", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import "./theme.scss";`,
        "src/theme.scss": "$color: red;",
      },
      {
        scripts: { build: "vite build" },
        devDependencies: {
          sass: "1.0.0",
          "sass-embedded": "1.0.0",
          vite: "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toContain("sass");
    expect(unusedPackageNames).not.toContain("sass-embedded");
  });

  it("credits Sass when it is the installed compiler for an observed host", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import "./theme.scss";`,
        "src/theme.scss": "$color: red;",
      },
      {
        scripts: { build: "vite build" },
        devDependencies: { sass: "1.0.0", vite: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).not.toContain("sass");
  });

  it("credits Sass for observed framework hosts while preserving source evidence", async () => {
    for (const frameworkPackage of ["next", "react-scripts", "gatsby", "astro"]) {
      const rootDirectory = createProject(
        {
          "src/index.ts": `import "./theme.scss";`,
          "src/theme.scss": "$color: red;",
        },
        {
          scripts: { build: `${frameworkPackage} build` },
          devDependencies: { sass: "1.0.0", [frameworkPackage]: "1.0.0" },
        },
      );

      const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

      expect(result.unusedDependencies.map((dependency) => dependency.name)).not.toContain("sass");
    }
  });

  it("does not infer Capacitor or Sass compiler use from declarations and stale paths", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "src/theme.scss": "$color: red;",
        "android/.gitkeep": "",
        "ios/.gitkeep": "",
      },
      {
        dependencies: {
          "@capacitor/core": "1.0.0",
          "@capacitor/android": "1.0.0",
          "@capacitor/ios": "1.0.0",
          vite: "1.0.0",
          "sass-embedded": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(
      expect.arrayContaining(["@capacitor/android", "@capacitor/ios", "sass-embedded"]),
    );
  });

  it("does not credit convention packages without their activation signal", async () => {
    const rootDirectory = createProject(
      { "src/index.ts": "console.log('app');" },
      {
        scripts: { lint: "oxlint" },
        dependencies: {
          "postinstall-postinstall": "1.0.0",
          "@astrojs/check": "1.0.0",
          "oxlint-tsgolint": "1.0.0",
          "@capacitor/core": "1.0.0",
          "@capacitor/android": "1.0.0",
          vite: "1.0.0",
          "sass-embedded": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(
      expect.arrayContaining([
        "postinstall-postinstall",
        "@astrojs/check",
        "oxlint-tsgolint",
        "@capacitor/android",
        "sass-embedded",
      ]),
    );
  });

  it("credits required installed peers but treats installed binaries as an index", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import usedPackage from "used-package"; console.log(usedPackage);`,
        "node_modules/used-package/package.json": JSON.stringify({
          name: "used-package",
          version: "1.0.0",
          peerDependencies: { "peer-package": "*" },
        }),
        "node_modules/bin-package/package.json": JSON.stringify({
          name: "bin-package",
          version: "1.0.0",
          bin: { "bin-command": "cli.js" },
        }),
      },
      {
        dependencies: {
          "used-package": "1.0.0",
          "peer-package": "1.0.0",
          "bin-package": "1.0.0",
          "unused-package": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toContain("unused-package");
    expect(unusedPackageNames).toContain("bin-package");
    expect(unusedPackageNames).not.toContain("used-package");
    expect(unusedPackageNames).not.toContain("peer-package");
  });

  it("suppresses diagnostics for gitignored and generated files", async () => {
    const rootDirectory = createProject(
      {
        ".gitignore": "src/ignored.ts\n",
        "src/index.ts": "console.log('app');",
        "src/ignored.ts": "export const ignored = 1;",
        "dist/generated.ts": "export const generated = 1;",
        "src/orphan.ts": "export const orphan = 1;",
      },
      {},
    );
    execFileSync("git", ["init", "--quiet"], { cwd: rootDirectory });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/orphan.ts");
    expect(unusedFilePaths).not.toEqual(
      expect.arrayContaining(["src/ignored.ts", "dist/generated.ts"]),
    );
  });

  it("suppresses dynamic and function-only cycles", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import { loadDynamic } from "./dynamic-a";
          import { callFunctionCycle } from "./function-a";
          console.log(loadDynamic, callFunctionCycle);
        `,
        "src/dynamic-a.ts": `
          export const loadDynamic = () => import("./dynamic-b");
        `,
        "src/dynamic-b.ts": `
          import { loadDynamic } from "./dynamic-a";
          export const dynamicB = () => loadDynamic;
        `,
        "src/function-a.ts": `
          import { functionB } from "./function-b";
          export const callFunctionCycle = () => functionB();
        `,
        "src/function-b.ts": `
          import { callFunctionCycle } from "./function-a";
          export const functionB = () => callFunctionCycle();
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toEqual([]);
  });

  it("does not mistake shadowed import names for module-initialization reads", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": 'import { cycleA } from "./cycle-a"; console.log(cycleA);',
        "src/cycle-a.ts": `
          import { cycleB } from "./cycle-b";
          {
            const cycleB = 1;
            console.log(cycleB);
          }
          ((cycleB) => console.log(cycleB))(1);
          export const cycleA = () => cycleB();
        `,
        "src/cycle-b.ts": `
          import { cycleA } from "./cycle-a";
          export const cycleB = () => cycleA();
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toEqual([]);
  });

  it("reports imported bindings read by an immediately invoked function", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": 'import { cycleA } from "./cycle-a"; console.log(cycleA);',
        "src/cycle-a.ts": `
          import { cycleB } from "./cycle-b";
          (() => console.log(cycleB))();
          export const cycleA = () => cycleB();
        `,
        "src/cycle-b.ts": `
          import { cycleA } from "./cycle-a";
          export const cycleB = () => cycleA();
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toHaveLength(1);
  });

  it("suppresses cycles that pass through generated route trees", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import { routeTree } from "./routeTree.gen";
          console.log(routeTree);
        `,
        "src/routeTree.gen.ts": `
          // This file was automatically generated by TanStack Router.
          import { Route } from "./routes/root";
          export const routeTree = Route;
        `,
        "src/routes/root.ts": `
          import { routeTree } from "../routeTree.gen";
          export const Route = routeTree;
        `,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.circularDependencies).toEqual([]);
  });

  it("scopes generated outputs to real GraphQL codegen configuration", async () => {
    const rootDirectory = createProject(
      {
        ".graphqlrc.json": JSON.stringify({ generates: { "./src/gql/": {} } }),
        "vite.config.ts": `
          import graphqlCodegen from "vite-plugin-graphql-codegen";
          const dormant = (graphqlCodegen) => graphqlCodegen({ generates: { "./src/authored/": {} } });
          export default { plugins: [] };
        `,
        "src/index.ts": "console.log('app');",
        "src/gql/graphql.ts": "export interface GeneratedShape { value: string }",
        "src/authored/manual.ts": "export interface ManualShape { value: string }",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/authored/manual.ts"]);
  });

  it("keeps negated and explanatory generated-via comments authored", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "src/negated.ts":
          "// This file is not generated via codegen; maintain manually.\nexport const negated = true;",
        "src/explainer.ts":
          "// This file documents how code is generated via our build.\nexport const explainer = true;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/explainer.ts",
      "src/negated.ts",
    ]);
  });

  it("only treats component paths inside Umi route arrays as entries", async () => {
    const rootDirectory = createProject(
      {
        ".umirc.ts": `export default {
          pluginOptions: { component: "@/unused" },
          routes: [{ path: "/", component: "@/used" }],
        };`,
        "src/used.tsx": "export default () => null;",
        "src/unused.tsx": "export default () => null;",
      },
      { dependencies: { umi: "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/unused.tsx");
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/used.tsx");
  });

  it("uses the root returned by a Vite config callback", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `export default defineConfig(() => {
          const preview = { root: "fixtures" };
          console.log(preview);
          return {};
        });`,
        "index.html": `<script type="module" src="/src/main.ts"></script>`,
        "src/main.ts": "console.log('app');",
        "fixtures/index.html": `<script type="module" src="/main.ts"></script>`,
        "fixtures/main.ts": "console.log('fixture');",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("fixtures/main.ts");
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/main.ts");
  });

  it("ignores dormant shadowed Taro page pushes", async () => {
    const rootDirectory = createProject(
      {
        "src/app.config.ts": `
          const pages = ["pages/home/index"];
          const dormant = () => { const pages = []; pages.push("pages/unused/index"); };
          console.log(dormant);
          export default { pages };
        `,
        "src/pages/home/index.tsx": "export default () => null;",
        "src/pages/unused/index.tsx": "export default () => null;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain(
      "src/pages/unused/index.tsx",
    );
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain(
      "src/pages/home/index.tsx",
    );
  });

  it("keeps filtered Taro pages without merging block-scoped pushes", async () => {
    const rootDirectory = createProject(
      {
        "src/app.config.ts": `
          const pages = ["pages/home/index"];
          {
            const pages = [];
            pages.push("pages/unused/index");
          }
          export default { pages: pages.filter(Boolean) };
        `,
        "src/pages/home/index.tsx": "export default () => null;",
        "src/pages/unused/index.tsx": "export default () => null;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain(
      "src/pages/unused/index.tsx",
    );
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain(
      "src/pages/home/index.tsx",
    );
  });

  it("ignores catch-bound Taro page pushes while preserving live catch pushes", async () => {
    const rootDirectory = createProject(
      {
        "src/app.config.ts": `
          const pages = ["pages/home/index"];
          try {
            throw [];
          } catch (pages) {
            pages.push("pages/shadowed/index");
          }
          try {
            throw new Error("include fallback");
          } catch (error) {
            console.log(error);
            pages.push("pages/fallback/index");
          }
          export default { pages };
        `,
        "src/pages/home/index.tsx": "export default () => null;",
        "src/pages/fallback/index.tsx": "export default () => null;",
        "src/pages/shadowed/index.tsx": "export default () => null;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toContain("src/pages/shadowed/index.tsx");
    expect(unusedFilePaths).not.toContain("src/pages/home/index.tsx");
    expect(unusedFilePaths).not.toContain("src/pages/fallback/index.tsx");
  });

  it("ignores loop-bound Taro page pushes while preserving live loop pushes", async () => {
    const rootDirectory = createProject(
      {
        "src/app.config.ts": `
          const pages = ["pages/home/index"];
          for (const pages of [[]]) {
            pages.push("pages/shadowed-for-of/index");
          }
          for (let pages = []; false; ) {
            pages.push("pages/shadowed-for/index");
          }
          for (const fallback of ["fallback"]) {
            console.log(fallback);
            pages.push("pages/fallback/index");
          }
          export default { pages };
        `,
        "src/pages/home/index.tsx": "export default () => null;",
        "src/pages/fallback/index.tsx": "export default () => null;",
        "src/pages/shadowed-for/index.tsx": "export default () => null;",
        "src/pages/shadowed-for-of/index.tsx": "export default () => null;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });
    const unusedFilePaths = relativePaths(rootDirectory, result.unusedFiles);

    expect(unusedFilePaths).toEqual(
      expect.arrayContaining([
        "src/pages/shadowed-for/index.tsx",
        "src/pages/shadowed-for-of/index.tsx",
      ]),
    );
    expect(unusedFilePaths).not.toContain("src/pages/home/index.tsx");
    expect(unusedFilePaths).not.toContain("src/pages/fallback/index.tsx");
  });

  it("ignores nested Webpack resolve objects outside the exported config", async () => {
    const rootDirectory = createProject(
      {
        "webpack.config.js": `
          module.exports = {
            entry: "./src/index.js",
            plugins: [{ options: { resolve: { modules: ["shared"] } } }],
          };
        `,
        "src/index.js": `import { value } from "thing"; console.log(value);`,
        "shared/thing.js": "export const value = true;",
      },
      { devDependencies: { webpack: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("shared/thing.js");
  });

  it("resolves callback-local Vite config identifiers", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          import { defineConfig } from "vite";
          export default defineConfig(() => {
            const config = { root: "app" };
            return config;
          });
        `,
        "app/index.html": `<script type="module" src="/main.ts"></script>`,
        "app/main.ts": "export const main = true;",
      },
      { devDependencies: { vite: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("app/main.ts");
  });

  it("resolves explicit extensions through a TypeScript base URL", async () => {
    const rootDirectory = createProject(
      {
        "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: "src" } }),
        "src/pages/index.astro": `---\nimport Layout from "Layout.astro";\n---\n<Layout />`,
        "src/Layout.astro": "<main>Layout</main>",
      },
      { dependencies: { astro: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/Layout.astro");
  });

  it("ignores GraphQL codegen calls inside dormant Vite helpers", async () => {
    const rootDirectory = createProject(
      {
        "vite.config.ts": `
          import { defineConfig } from "vite";
          import graphqlCodegen from "vite-plugin-graphql-codegen";
          export default defineConfig(() => {
            function dormant() {
              return graphqlCodegen({ generates: { "./src/authored/": {} } });
            }
            console.log(dormant);
            return { plugins: [] };
          });
        `,
        "src/authored/manual.ts": "export const manual = true;",
      },
      {
        devDependencies: {
          vite: "1.0.0",
          "vite-plugin-graphql-codegen": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain("src/authored/manual.ts");
  });

  it("expands statically bound Umi route array spreads", async () => {
    const rootDirectory = createProject(
      {
        ".umirc.ts": `
          const extraRoutes = [{ path: "/manual", component: "@/manual" }];
          export default { routes: [...extraRoutes] };
        `,
        "src/manual.tsx": "export default () => null;",
      },
      { dependencies: { react: "1.0.0", umi: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain("src/manual.tsx");
  });

  it("skips CommonMark code and HTML comments while retaining live MDX imports", async () => {
    const rootDirectory = createProject(
      {
        "src/page.mdx": [
          "    export function IndentedExample(",
          "<!--",
          "export function CommentedExample(",
          "-->",
          "```tsx",
          "```not-a-close",
          "export function FencedExample(",
          "```",
          'import { Demo } from "./demo";',
          "",
          "<Demo />",
        ].join("\n"),
        "src/demo.tsx": "export const Demo = () => null;",
        "src/orphan.ts": "export const orphan = true;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/page.mdx"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("does not infer Sass compiler use from unreachable Sass files", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "src/orphan.scss": "$color: red;",
      },
      { scripts: { build: "next build" }, devDependencies: { next: "1.0.0", sass: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedDependencies.map((dependency) => dependency.name)).toContain("sass");
  });

  it("does not infer Parcel Sass use from an HTML file outside the Parcel entry command", async () => {
    const rootDirectory = createProject(
      {
        "src/index.html": "<main>Application</main>",
        "examples/old.html": '<link rel="stylesheet" href="./old.scss" />',
        "examples/old.scss": "$color: red;",
      },
      {
        scripts: { build: "parcel src/index.html" },
        devDependencies: { "parcel-bundler": "1.0.0", sass: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(result.unusedDependencies.map((dependency) => dependency.name)).toContain("sass");
  });

  it("does not infer Parcel Sass use from a commented stylesheet link", async () => {
    const rootDirectory = createProject(
      {
        "src/index.html": '<!-- <link rel="stylesheet" href="./old.scss" /> -->',
        "src/old.scss": "$color: red;",
      },
      {
        scripts: { build: "parcel src/index.html" },
        devDependencies: { "parcel-bundler": "1.0.0", sass: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(result.unusedDependencies.map((dependency) => dependency.name)).toContain("sass");
  });

  it("credits Sass through a live Sass loader and an extensionless build script", async () => {
    for (const files of [
      {
        "src/index.ts": `import "./theme.scss";`,
        "src/theme.scss": "$color: red;",
        "webpack.config.js": `module.exports = { module: { rules: [{ use: ["sass-loader"] }] } };`,
      },
      {
        "src/index.ts": "console.log('app');",
        "src/theme.scss": "$color: red;",
        "bin/build-css": "#!/usr/bin/env bash\nsass src/theme.scss dist/theme.css",
      },
    ]) {
      const rootDirectory = createProject(files, {
        scripts: { build: "bin/build-css" in files ? "./bin/build-css" : "webpack" },
        devDependencies: { sass: "1.0.0", "sass-loader": "1.0.0", webpack: "1.0.0" },
      });
      const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
      expect(result.unusedDependencies.map((dependency) => dependency.name)).not.toContain("sass");
    }
  });

  it.each([
    {
      compilerInput: "an Astro import",
      files: {
        "src/index.ts": "console.log('app');",
        "src/pages/index.astro": '---\nimport "../styles.scss";\n---\n<main />',
        "src/styles.scss": "$color: red;",
      },
      scripts: { build: "astro build" },
      tools: { astro: "1.0.0" },
    },
    {
      compilerInput: "a Parcel HTML stylesheet link",
      files: {
        "src/index.ts": "console.log('app');",
        "src/html/index.html":
          '<html><head><link href="../styles.scss" rel="stylesheet" /></head></html>',
        "src/styles.scss": "$color: red;",
      },
      scripts: { build: "parcel src/html/index.html" },
      tools: { "parcel-bundler": "1.0.0" },
    },
    {
      compilerInput: "a Sass loader module import",
      files: {
        "src/index.ts": "console.log('app');",
        "src/admin.tsx": 'import "./admin.scss"; export const Admin = () => null;',
        "src/admin.scss": "$color: red;",
        "webpack.config.js":
          'module.exports = { entry: "./src/admin.tsx", module: { rules: [{ use: ["sass-loader"] }] } };',
      },
      scripts: { build: "webpack" },
      tools: { "sass-loader": "1.0.0", webpack: "1.0.0" },
    },
  ])("credits Sass through $compilerInput outside the reachable module graph", async (project) => {
    const rootDirectory = createProject(project.files, {
      scripts: project.scripts,
      devDependencies: { sass: "1.0.0", ...project.tools },
    });
    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedDependencies.map((dependency) => dependency.name)).not.toContain("sass");
  });

  it("does not execute escaped cross-env-shell separators or heredoc payloads", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('app');",
        "bin/write-docs": [
          "#!/usr/bin/env bash",
          "cat <<FIRST <<-'SECOND'",
          "payload-tool first",
          "FIRST",
          "\tpayload-tool second",
          "\tSECOND",
        ].join("\n"),
      },
      {
        scripts: {
          escapedQuoted: 'cross-env-shell "echo foo\\; escaped-tool build"',
          escapedUnquoted: "cross-env-shell echo foo\\; escaped-tool build",
          docs: "./bin/write-docs",
          quotedHeredoc: "echo '<<EOF'\nreal-tool build",
        },
        devDependencies: {
          "escaped-tool": "1.0.0",
          "payload-tool": "1.0.0",
          "real-tool": "1.0.0",
        },
      },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });
    const unusedPackageNames = result.unusedDependencies.map((dependency) => dependency.name);

    expect(unusedPackageNames).toEqual(expect.arrayContaining(["escaped-tool", "payload-tool"]));
    expect(unusedPackageNames).not.toContain("real-tool");
  });

  it("follows Webpack require.context entries through partially parsed modules", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import items from "./items"; console.log(items);`,
        "src/items/index.js": `
          const context = require.context(".", true, /^\\.\\/[a-z\\-]+?\\/index\\.(js|jsx)$/);
          export default context.keys();
        `,
        "src/items/button/index.jsx": `
          import detail from "./detail";
          export default class Button { bind = ::this.render; render() { return detail; } }
        `,
        "src/items/button/detail.js": `export default "button";`,
        "src/orphan.ts": "export const orphan = true;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("preserves fixed paths in Webpack require.context expressions", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `require.context(".", true, /^\\.\\/admin\\/index\\.(js|jsx)$/);`,
        "src/admin/index.jsx": "export default null;",
        "src/other/index.jsx": "export default null;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/other/index.jsx"]);
  });

  it("does not reinterpret absolute Webpack require.context directories as project roots", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `require.context("/outside", true, /^\\.\\/index\\.(js|jsx)$/);`,
        "outside/index.jsx": "export default null;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["outside/index.jsx"]);
  });

  it("keeps live filename registries populated with push", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          const pages = [];
          pages.push("pages/consumed/index");
          console.log(pages);
        `,
        "src/pages/consumed/index.ts": "export const consumed = true;",
        "src/orphan.ts": "export const orphan = true;",
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("keeps reachable Taro platform siblings", async () => {
    const rootDirectory = createProject(
      {
        "src/app.tsx": `import { platform } from "./platform"; console.log(platform);`,
        "src/app.rn.tsx": `import { platform } from "./platform"; console.log(platform);`,
        "src/platform.ts": `export const platform = "default";`,
        "src/platform.h5.ts": `export const platform = "h5";`,
        "src/platform.rn.ts": `export const platform = "rn";`,
        "src/platform.weapp.ts": `export const platform = "weapp";`,
        "src/orphan.ts": "export const orphan = true;",
      },
      { dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("reports framework-specific platform siblings outside their hosts", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import { platform } from "./platform"; console.log(platform);`,
        "src/platform.ts": `export const platform = "default";`,
        "src/platform.h5.ts": `export const platform = "h5";`,
        "src/platform.rn.ts": `export const platform = "rn";`,
      },
      {},
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/platform.h5.ts",
      "src/platform.rn.ts",
    ]);
  });

  it("scopes framework platform siblings to their workspace package", async () => {
    const rootDirectory = createProject(
      {
        "packages/taro/package.json": JSON.stringify({
          name: "@example/taro",
          dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" },
        }),
        "packages/taro/src/app.tsx": `import { value } from "./value"; console.log(value);`,
        "packages/taro/src/value.ts": "export const value = true;",
        "packages/taro/src/value.h5.ts": "export const value = true;",
        "packages/web/package.json": JSON.stringify({
          name: "@example/web",
          exports: "./src/index.ts",
        }),
        "packages/web/src/index.ts": `import { value } from "./value"; console.log(value);`,
        "packages/web/src/value.ts": "export const value = true;",
        "packages/web/src/value.h5.ts": "export const value = true;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).toContain(
      "packages/web/src/value.h5.ts",
    );
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain(
      "packages/taro/src/value.h5.ts",
    );
  });

  it("inherits root framework platform capabilities inside workspace packages", async () => {
    const rootDirectory = createProject(
      {
        "packages/application/package.json": JSON.stringify({
          name: "@example/application",
          exports: "./src/index.ts",
        }),
        "packages/application/src/index.ts": 'import { value } from "./value"; console.log(value);',
        "packages/application/src/value.ts": "export const value = true;",
        "packages/application/src/value.h5.ts": "export const value = true;",
        "packages/application/src/value.weapp.ts": "export const value = true;",
      },
      {
        private: true,
        workspaces: ["packages/*"],
        dependencies: { "@tarojs/react": "1.0.0", react: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain(
      "packages/application/src/value.h5.ts",
    );
    expect(relativePaths(rootDirectory, result.unusedFiles)).not.toContain(
      "packages/application/src/value.weapp.ts",
    );
  });
});
