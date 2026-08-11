import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProject } from "../src/project-analysis/analyze-project.js";

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
  return fs.realpathSync(rootDirectory);
};

const relativePath = (rootDirectory: string, filePath: string): string =>
  path.relative(rootDirectory, filePath).replaceAll("\\", "/");

const relativePaths = (
  rootDirectory: string,
  findings: ReadonlyArray<{ readonly path: string }>,
): string[] => findings.map((finding) => relativePath(rootDirectory, finding.path));

describe("analyzeProject", () => {
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

  it("credits known binary aliases, release config plugins, and wrapper peers", async () => {
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

    expect(unusedPackageNames).not.toEqual(
      expect.arrayContaining([
        "apexcharts",
        "@babel/cli",
        "@remix-run/serve",
        "release-plugin",
        "release-package-json-plugin",
      ]),
    );
  });

  it("credits installed peer dependencies and packages that provide binaries", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `import usedPackage from "used-package"; console.log(usedPackage);`,
        "node_modules/used-package/package.json": JSON.stringify({
          name: "used-package",
          peerDependencies: { "peer-package": "*" },
        }),
        "node_modules/bin-package/package.json": JSON.stringify({
          name: "bin-package",
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
    expect(unusedPackageNames).not.toEqual(
      expect.arrayContaining(["used-package", "peer-package", "bin-package"]),
    );
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
});
