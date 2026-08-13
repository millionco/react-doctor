import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { analyzeProjectForWorker as analyzeProject } from "../src/project-analysis/analyze-project.js";

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
  const rootDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "react-doctor-unused-file-completeness-"),
  );
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(packageJson));
  for (const [relativePath, source] of Object.entries(files)) {
    const filePath = path.join(rootDirectory, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, source);
  }
  return fs.realpathSync(rootDirectory);
};

const unusedFilePaths = (
  rootDirectory: string,
  unusedFiles: ReadonlyArray<{ readonly path: string }>,
): string[] =>
  unusedFiles.map((unusedFile) =>
    path.relative(rootDirectory, unusedFile.path).replaceAll("\\", "/"),
  );

describe("unused-file graph completeness", () => {
  it("reports an unreachable file in a complete explicit entry graph", async () => {
    const rootDirectory = createProject({
      "src/index.ts": 'import "./used";',
      "src/used.ts": "export const used = true;",
      "src/orphan.ts": "export const orphan = true;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(unusedFilePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("reports an unreachable file when configured aliases resolve", async () => {
    const rootDirectory = createProject({
      "src/index.ts": 'import { value } from "@app/value"; console.log(value);',
      "src/lib/value.ts": "export const value = true;",
      "src/lib/orphan.ts": "export const orphan = true;",
      "tsconfig.json": JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@app/*": ["src/lib/*"] } },
      }),
    });

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["src/index.ts"],
      tsConfigPath: path.join(rootDirectory, "tsconfig.json"),
    });

    expect(unusedFilePaths(rootDirectory, result.unusedFiles)).toEqual(["src/lib/orphan.ts"]);
  });

  it.each([
    {
      name: "default entry heuristic",
      files: {
        "src/index.ts": "export const entry = true;",
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: {},
      entryPatterns: undefined,
    },
    {
      name: "parse failure",
      files: {
        "src/index.ts": "export const entry = true;",
        "src/broken.ts": "export const = ;",
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: {},
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "unresolved local import",
      files: {
        "src/index.ts": 'import "./missing";',
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: {},
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "unresolved import alias",
      files: {
        "src/index.ts": 'import "#feature";',
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: {},
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "computed dynamic loader",
      files: {
        "src/index.ts": "export const load = (name: string) => import('./features/' + name);",
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: {},
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "computed require",
      files: {
        "src/index.ts": "export const load = (name: string) => require(name);",
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: {},
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "computed createJiti instance import",
      files: {
        "src/index.ts": `
          import { createJiti } from "jiti";
          const runtimeLoader = createJiti(import.meta.url);
          export const load = (name: string) => runtimeLoader.import(name);
        `,
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: { dependencies: { jiti: "1.0.0" } },
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "computed inline createJiti import",
      files: {
        "src/index.ts": `
          import { createJiti as makeJiti } from "jiti";
          export const load = (name: string) => makeJiti(import.meta.url).import(name);
        `,
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: { dependencies: { jiti: "1.0.0" } },
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "imported Jiti with a shadowed factory name in another scope",
      files: {
        "src/index.ts": `
          import { createJiti } from "jiti";
          const runtimeLoader = createJiti(import.meta.url);
          const passthrough = (createJiti: unknown) => createJiti;
          export const load = (name: string) => runtimeLoader.import(name);
          console.log(passthrough);
        `,
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: { dependencies: { jiti: "1.0.0" } },
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "runtime directory enumeration",
      files: {
        "src/index.ts":
          'import { readdirSync } from "node:fs"; export const files = readdirSync("./features");',
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: {},
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "partially parsed container",
      files: {
        "src/index.ts": "export const entry = true;",
        "src/component.vue": "<template><div /></template>",
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: {},
      entryPatterns: ["src/index.ts"],
    },
    {
      name: "unsupported framework contract",
      files: {
        "src/index.ts": "export const entry = true;",
        "src/orphan.ts": "export const orphan = true;",
      },
      packageJson: { dependencies: { electron: "1.0.0" } },
      entryPatterns: ["src/index.ts"],
    },
  ])("suppresses findings for $name uncertainty", async ({ files, packageJson, entryPatterns }) => {
    const rootDirectory = createProject(files, packageJson);

    const result = await analyzeProject({ rootDirectory, entryPatterns });

    expect(result.unusedFiles).toEqual([]);
  });

  it.skipIf(process.platform === "win32")(
    "suppresses findings when an owning-package source is unreadable",
    async () => {
      const rootDirectory = createProject({
        "src/index.ts": "export const entry = true;",
        "src/unreadable.ts": "export const unreadable = true;",
        "src/orphan.ts": "export const orphan = true;",
      });
      fs.chmodSync(path.join(rootDirectory, "src/unreadable.ts"), 0);

      const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

      expect(result.unusedFiles).toEqual([]);
    },
  );

  it("does not treat ordinary computed calls as module-loader uncertainty", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          import { loadModule } from "runtime-loader";
          const jiti = (value: string) => value;
          export const value = [
            calculateValue(process.env.INPUT),
            jiti(process.env.INPUT),
            loadModule(process.env.INPUT),
          ];
        `,
        "src/orphan.ts": "export const orphan = true;",
      },
      { dependencies: { "runtime-loader": "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(unusedFilePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("links a static CommonJS Jiti module load", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": `
          const jiti = require("jiti")(__filename);
          export const schema = jiti("./runtime-schema.ts");
        `,
        "src/runtime-schema.ts": "export const runtimeSchema = true;",
        "src/orphan.ts": "export const orphan = true;",
      },
      { dependencies: { jiti: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(unusedFilePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("does not link paths passed to an ordinary imported helper", async () => {
    const rootDirectory = createProject({
      "src/index.ts": `
        import { loadModule } from "./ordinary-helper";
        export const value = loadModule("./runtime-schema.ts");
      `,
      "src/ordinary-helper.ts": "export const loadModule = (value: string) => value;",
      "src/runtime-schema.ts": "export const runtimeSchema = true;",
      "src/orphan.ts": "export const orphan = true;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(unusedFilePaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/orphan.ts",
      "src/runtime-schema.ts",
    ]);
  });

  it("normalizes Windows separators before recognizing test contracts", async () => {
    const rootDirectory = createProject({
      "src/index.ts": "export const entry = true;",
      "tests\\fixture.ts": "export const fixture = true;",
      "src/orphan.ts": "export const orphan = true;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(result.unusedFiles).toEqual([]);
  });

  it("keeps a simple supported Next route graph useful without user entry patterns", async () => {
    const rootDirectory = createProject(
      {
        "pages/index.tsx": "export default function Page() { return null; }",
        "src/orphan.ts": "export const orphan = true;",
      },
      {
        scripts: { dev: "next dev", build: "next build", start: "next start" },
        dependencies: { next: "1.0.0", react: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(unusedFilePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it("recognizes the Create React App development proxy entry", async () => {
    const rootDirectory = createProject(
      {
        "src/index.tsx": "export const application = true;",
        "src/setupProxy.js": "module.exports = (application) => application;",
        "src/orphan.ts": "export const orphan = true;",
      },
      {
        scripts: { start: "react-scripts start", build: "react-scripts build" },
        dependencies: { "react-scripts": "1.0.0", react: "1.0.0" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(unusedFilePaths(rootDirectory, result.unusedFiles)).toEqual(["src/orphan.ts"]);
  });

  it.each([
    {
      name: "unsupported package script",
      files: {},
      packageJsonExtension: { scripts: { dev: "next dev", generate: "node generate.js" } },
    },
    {
      name: "custom Next application directory",
      files: {},
      packageJsonExtension: { scripts: { dev: "next dev custom-app" } },
    },
    {
      name: "unsupported build config",
      files: { "next.config.js": "module.exports = {};" },
      packageJsonExtension: { scripts: { dev: "next dev" } },
    },
    {
      name: "wildcard package side effects",
      files: {},
      packageJsonExtension: { scripts: { dev: "next dev" }, sideEffects: ["src/*.ts"] },
    },
    {
      name: "unparseable compiler config",
      files: { "tsconfig.json": "{" },
      packageJsonExtension: { scripts: { dev: "next dev" } },
    },
  ])(
    "suppresses automatic roots for $name uncertainty",
    async ({ files, packageJsonExtension }) => {
      const rootDirectory = createProject(
        {
          "pages/index.tsx": "export default function Page() { return null; }",
          "src/orphan.ts": "export const orphan = true;",
          ...files,
        },
        {
          ...packageJsonExtension,
          dependencies: { next: "1.0.0", react: "1.0.0" },
        },
      );

      const result = await analyzeProject({ rootDirectory });

      expect(result.unusedFiles).toEqual([]);
    },
  );

  it("isolates uncertainty to its owning workspace package", async () => {
    const rootDirectory = createProject(
      {
        "packages/complete/package.json": JSON.stringify({ name: "complete" }),
        "packages/complete/src/index.ts": "export const entry = true;",
        "packages/complete/src/orphan.ts": "export const orphan = true;",
        "packages/uncertain/package.json": JSON.stringify({ name: "uncertain" }),
        "packages/uncertain/src/index.ts":
          "export const load = (name: string) => import('./features/' + name);",
        "packages/uncertain/src/orphan.ts": "export const orphan = true;",
      },
      { private: true, workspaces: ["packages/*"] },
    );

    const result = await analyzeProject({
      rootDirectory,
      entryPatterns: ["packages/*/src/index.ts"],
    });

    expect(unusedFilePaths(rootDirectory, result.unusedFiles)).toEqual([
      "packages/complete/src/orphan.ts",
    ]);
  });

  it("applies root package contract uncertainty to nested automatic roots", async () => {
    const rootDirectory = createProject(
      {
        "packages/application/package.json": JSON.stringify({
          name: "application",
          scripts: { dev: "next dev" },
          dependencies: { next: "1.0.0", react: "1.0.0" },
        }),
        "packages/application/pages/index.tsx": "export default function Page() { return null; }",
        "packages/application/src/orphan.ts": "export const orphan = true;",
      },
      {
        private: true,
        workspaces: ["packages/*"],
        scripts: { generate: "node generate.js" },
      },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(result.unusedFiles).toEqual([]);
  });
});
