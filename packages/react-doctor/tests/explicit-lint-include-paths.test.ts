import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { ProjectInfo } from "@react-doctor/core";
import { computeExplicitLintIncludePaths } from "@react-doctor/core";

let tempDirectory: string;

const buildProject = (overrides?: Partial<ProjectInfo>): ProjectInfo => ({
  rootDirectory: tempDirectory,
  projectName: "vite-app",
  reactVersion: "19.0.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework: "vite",
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion: null,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  isPreES2023Target: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 0,
  ...overrides,
});

const writeFixtureFile = (relativePath: string, content: string): void => {
  const absolutePath = path.join(tempDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
};

describe("computeExplicitLintIncludePaths", () => {
  beforeEach(() => {
    tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-explicit-includes-"));
  });

  afterEach(() => {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  });

  it("returns undefined for empty include paths", () => {
    expect(computeExplicitLintIncludePaths([])).toBeUndefined();
  });

  it("keeps JSX/TSX files without reading them", () => {
    const result = computeExplicitLintIncludePaths(
      ["src/app.tsx", "src/Button.jsx", "README.md", "src/styles.css"],
      buildProject(),
    );
    expect(result).toEqual(["src/app.tsx", "src/Button.jsx"]);
  });

  it("keeps a changed .ts hook that imports react", () => {
    writeFixtureFile(
      "src/hooks/useColorManipulation.ts",
      'import { useEffect, useState } from "react";\nexport const useColorManipulation = () => useState(0);\n',
    );
    const result = computeExplicitLintIncludePaths(
      ["src/hooks/useColorManipulation.ts"],
      buildProject(),
    );
    expect(result).toEqual(["src/hooks/useColorManipulation.ts"]);
  });

  it("keeps a changed .ts file that calls hooks without importing react directly", () => {
    writeFixtureFile(
      "src/hooks/use-theme.ts",
      'import { useColorManipulation } from "./useColorManipulation.js";\nexport const useTheme = () => useColorManipulation();\n',
    );
    const result = computeExplicitLintIncludePaths(["src/hooks/use-theme.ts"], buildProject());
    expect(result).toEqual(["src/hooks/use-theme.ts"]);
  });

  it("drops changed non-React .ts/.js files so diff scopes stay quiet on server and utility code", () => {
    writeFixtureFile("src/utils.ts", "export const clamp = (n: number) => Math.min(1, n);\n");
    writeFixtureFile("src/config.js", "module.exports = { retries: 3 };\n");
    const result = computeExplicitLintIncludePaths(
      ["src/utils.ts", "src/config.js"],
      buildProject(),
    );
    expect(result).toEqual([]);
  });

  it("drops non-JSX paths whose content cannot be read", () => {
    const result = computeExplicitLintIncludePaths(["src/missing.ts"], buildProject());
    expect(result).toEqual([]);
  });

  it("drops non-JSX paths when no project is provided", () => {
    expect(computeExplicitLintIncludePaths(["src/utils.ts"])).toEqual([]);
  });

  it("keeps Next middleware and proxy entry files in Next projects without reading them", () => {
    const paths = [
      "middleware.ts",
      "middleware.mjs",
      "src/proxy.ts",
      "src/proxy.mts",
      "src/app.tsx",
      "nested/middleware.ts",
    ];

    const result = computeExplicitLintIncludePaths(
      paths,
      buildProject({
        projectName: "next-app",
        framework: "nextjs",
        nextjsVersion: "^16.0.0",
        nextjsMajorVersion: 16,
      }),
    );

    expect(result).toEqual([
      "middleware.ts",
      "middleware.mjs",
      "src/proxy.ts",
      "src/proxy.mts",
      "src/app.tsx",
    ]);
  });

  it("does not keep Next entry filenames for non-Next projects", () => {
    const result = computeExplicitLintIncludePaths(
      ["middleware.ts", "src/proxy.mjs", "src/App.tsx"],
      buildProject(),
    );
    expect(result).toEqual(["src/App.tsx"]);
  });
});
