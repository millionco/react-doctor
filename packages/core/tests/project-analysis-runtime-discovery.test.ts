import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
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
  packageJson: Readonly<Record<string, unknown>> = {},
): string => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-runtime-discovery-"));
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

describe("runtime-discovered project entries", () => {
  it("expands static globby calls in framework entries with their exact cwd and exclusions", async () => {
    const rootDirectory = createProject(
      {
        "src/app/experiments/[...slug]/page.tsx": `
          import { dirname, resolve } from "node:path";
          import { fileURLToPath } from "node:url";
          import { globby } from "globby";
          const currentDirectory = dirname(fileURLToPath(import.meta.url));
          const experimentsRootDirectory = resolve(currentDirectory, "..");
          export const generateStaticParams = async () => globby(
            ["**/*.tsx", "!infra/**/*", "!**/page.tsx"],
            { cwd: experimentsRootDirectory },
          );
          export default () => null;
        `,
        "src/app/experiments/menu/basic.tsx": "export default null;",
        "src/app/experiments/infra/private.tsx": "export default null;",
        "src/app/experiments/unused/page.tsx": "export default null;",
        "src/orphan.ts": "export const orphan = true;",
      },
      { dependencies: { next: "1.0.0", globby: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/app/experiments/infra/private.tsx",
      "src/orphan.ts",
    ]);
  });

  it("does not activate globby calls from unreachable modules or unrelated functions", async () => {
    const rootDirectory = createProject(
      {
        "src/index.ts": "console.log('entry');",
        "src/dormant-registry.ts": `
          import { globby } from "globby";
          export const modules = globby("./modules/*.ts");
        `,
        "src/unrelated.ts": `
          const globby = (pattern: string) => pattern;
          globby("./modules/*.ts");
        `,
        "src/modules/hidden.ts": "export const hidden = true;",
      },
      { dependencies: { globby: "1.0.0" } },
    );

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "src/dormant-registry.ts",
      "src/modules/hidden.ts",
      "src/unrelated.ts",
    ]);
  });

  it("discovers default and configured Netlify function directories only with netlify.toml", async () => {
    const defaultRoot = createProject({
      "src/index.ts": "console.log('entry');",
      "netlify.toml": "[build]\ncommand = 'build'",
      "netlify/functions/notify.ts": "export default () => new Response();",
      "functions/dormant.ts": "export default () => new Response();",
    });
    const configuredRoot = createProject({
      "src/index.ts": "console.log('entry');",
      "netlify.toml": "[functions]\ndirectory = 'server/functions'",
      "netlify/functions/dormant.ts": "export default () => new Response();",
      "server/functions/notify.ts": "export default () => new Response();",
    });
    const unrelatedRoot = createProject({
      "src/index.ts": "console.log('entry');",
      "netlify/functions/dormant.ts": "export default () => new Response();",
    });

    const [defaultResult, configuredResult, unrelatedResult] = await Promise.all([
      analyzeProject({ rootDirectory: defaultRoot, entryPatterns: ["src/index.ts"] }),
      analyzeProject({ rootDirectory: configuredRoot, entryPatterns: ["src/index.ts"] }),
      analyzeProject({ rootDirectory: unrelatedRoot, entryPatterns: ["src/index.ts"] }),
    ]);

    expect(relativeUnusedPaths(defaultRoot, defaultResult.unusedFiles)).toEqual([
      "functions/dormant.ts",
    ]);
    expect(relativeUnusedPaths(configuredRoot, configuredResult.unusedFiles)).toEqual([
      "netlify/functions/dormant.ts",
    ]);
    expect(relativeUnusedPaths(unrelatedRoot, unrelatedResult.unusedFiles)).toEqual([
      "netlify/functions/dormant.ts",
    ]);
  });
});

describe("tool-consumed source conventions", () => {
  it("keeps MUI docs metadata files only when the docs infrastructure is installed", async () => {
    const enabledRoot = createProject(
      {
        "src/index.ts": "console.log('entry');",
        "src/button/ButtonDataAttributes.ts":
          "export enum ButtonDataAttributes { pressed = 'data-pressed' }",
        "src/button/ButtonCssVars.ts": "export enum ButtonCssVars { width = '--button-width' }",
        "src/button/ButtonDormant.ts": "export const dormant = true;",
      },
      { devDependencies: { "@mui/internal-docs-infra": "1.0.0" } },
    );
    const disabledRoot = createProject({
      "src/index.ts": "console.log('entry');",
      "src/button/ButtonDataAttributes.ts":
        "export enum ButtonDataAttributes { pressed = 'data-pressed' }",
    });

    const [enabledResult, disabledResult] = await Promise.all([
      analyzeProject({ rootDirectory: enabledRoot, entryPatterns: ["src/index.ts"] }),
      analyzeProject({ rootDirectory: disabledRoot, entryPatterns: ["src/index.ts"] }),
    ]);

    expect(relativeUnusedPaths(enabledRoot, enabledResult.unusedFiles)).toEqual([
      "src/button/ButtonDormant.ts",
    ]);
    expect(relativeUnusedPaths(disabledRoot, disabledResult.unusedFiles)).toEqual([
      "src/button/ButtonDataAttributes.ts",
    ]);
  });

  it("keeps the internal bundle-size checker default config only with its package", async () => {
    const enabledRoot = createProject(
      {
        "src/index.ts": "console.log('entry');",
        "bundle-size-checker.config.mjs": "export default {};",
        "unrelated.config.mjs": "export default {};",
      },
      { devDependencies: { "@mui/internal-bundle-size-checker": "1.0.0" } },
    );
    const disabledRoot = createProject({
      "src/index.ts": "console.log('entry');",
      "bundle-size-checker.config.mjs": "export default {};",
    });

    const [enabledResult, disabledResult] = await Promise.all([
      analyzeProject({ rootDirectory: enabledRoot, entryPatterns: ["src/index.ts"] }),
      analyzeProject({ rootDirectory: disabledRoot, entryPatterns: ["src/index.ts"] }),
    ]);

    expect(relativeUnusedPaths(enabledRoot, enabledResult.unusedFiles)).toEqual([
      "unrelated.config.mjs",
    ]);
    expect(relativeUnusedPaths(disabledRoot, disabledResult.unusedFiles)).toEqual([
      "bundle-size-checker.config.mjs",
    ]);
  });

  it("keeps compiler-only public type fixture inputs without widening ordinary packages", async () => {
    const rootDirectory = createProject({
      "src/index.ts": "console.log('entry');",
      "public-types/package.json": JSON.stringify({
        private: true,
        scripts: { test: "tsc --noEmit" },
      }),
      "public-types/tsconfig.json": JSON.stringify({
        compilerOptions: { noEmit: true },
        include: ["**/*.ts", "**/*.tsx"],
        exclude: ["excluded/**"],
      }),
      "public-types/use-render.tsx": "export const fixture = <div />;",
      "public-types/excluded/dormant.ts": "export const dormant = true;",
      "ordinary/package.json": JSON.stringify({ private: true, scripts: { test: "tsc --noEmit" } }),
      "ordinary/tsconfig.json": JSON.stringify({
        compilerOptions: { noEmit: true },
        include: ["**/*.ts"],
      }),
      "ordinary/dormant.ts": "export const dormant = true;",
    });

    const result = await analyzeProject({ rootDirectory, entryPatterns: ["src/index.ts"] });

    expect(relativeUnusedPaths(rootDirectory, result.unusedFiles)).toEqual([
      "ordinary/dormant.ts",
      "public-types/excluded/dormant.ts",
    ]);
  });
});
