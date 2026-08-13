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
