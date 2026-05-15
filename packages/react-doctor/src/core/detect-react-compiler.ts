import fs from "node:fs";
import path from "node:path";
import type { PackageJson } from "../types/project-info.js";
import { isFile } from "./is-file.js";
import { collectAllDependencies } from "./collect-all-dependencies.js";
import { isMonorepoRoot } from "./find-monorepo-root.js";
import { readPackageJson } from "./read-package-json.js";

const REACT_COMPILER_PACKAGES = new Set([
  "babel-plugin-react-compiler",
  "react-compiler-runtime",
  "eslint-plugin-react-compiler",
]);

const NEXT_CONFIG_FILENAMES = [
  "next.config.js",
  "next.config.mjs",
  "next.config.ts",
  "next.config.cjs",
];

const BABEL_CONFIG_FILENAMES = [
  ".babelrc",
  ".babelrc.json",
  "babel.config.js",
  "babel.config.json",
  "babel.config.cjs",
  "babel.config.mjs",
];

const VITE_CONFIG_FILENAMES = [
  "vite.config.js",
  "vite.config.ts",
  "vite.config.mjs",
  "vite.config.mts",
  "vite.config.cjs",
  "vite.config.cts",
  "vitest.config.ts",
  "vitest.config.js",
];

const EXPO_APP_CONFIG_FILENAMES = ["app.json", "app.config.js", "app.config.ts"];

const REACT_COMPILER_PACKAGE_REFERENCE_PATTERN =
  /babel-plugin-react-compiler|react-compiler-runtime|eslint-plugin-react-compiler|["']react-compiler["']/;
const REACT_COMPILER_ENABLED_FLAG_PATTERN = /["']?reactCompiler["']?\s*:\s*(?:true\b|\{)/;

const hasCompilerPackage = (packageJson: PackageJson): boolean => {
  const allDependencies = collectAllDependencies(packageJson);
  return Object.keys(allDependencies).some((packageName) =>
    REACT_COMPILER_PACKAGES.has(packageName),
  );
};

const hasCompilerInConfigFile = (filePath: string): boolean => {
  if (!isFile(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf-8");
  return (
    REACT_COMPILER_ENABLED_FLAG_PATTERN.test(content) ||
    REACT_COMPILER_PACKAGE_REFERENCE_PATTERN.test(content)
  );
};

const hasCompilerInConfigFiles = (directory: string, filenames: string[]): boolean =>
  filenames.some((filename) => hasCompilerInConfigFile(path.join(directory, filename)));

const isProjectBoundary = (directory: string): boolean => {
  if (fs.existsSync(path.join(directory, ".git"))) return true;
  return isMonorepoRoot(directory);
};

export const detectReactCompiler = (directory: string, packageJson: PackageJson): boolean => {
  if (hasCompilerPackage(packageJson)) return true;

  if (hasCompilerInConfigFiles(directory, NEXT_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, BABEL_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, VITE_CONFIG_FILENAMES)) return true;
  if (hasCompilerInConfigFiles(directory, EXPO_APP_CONFIG_FILENAMES)) return true;

  if (isProjectBoundary(directory)) return false;

  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    if (isFile(ancestorPackagePath)) {
      const ancestorPackageJson = readPackageJson(ancestorPackagePath);
      if (hasCompilerPackage(ancestorPackageJson)) return true;
    }
    if (isProjectBoundary(ancestorDirectory)) return false;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};
