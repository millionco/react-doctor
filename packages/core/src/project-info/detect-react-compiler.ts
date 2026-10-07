import * as path from "node:path";
import type { PackageJson } from "../types/index.js";
import { isProjectBoundary } from "../utils/is-project-boundary.js";
import { isFile } from "./fs-utils.js";
import {
  hasReactCompilerConfiguration,
  hasReactCompilerConfigurationInAncestors,
} from "./react-compiler-config-evaluator.js";
import { readPackageJson } from "./package-json.js";

const REACT_COMPILER_LINT_PACKAGES = new Set(["eslint-plugin-react-compiler"]);
const REACT_COMPILER_RUNTIME_PACKAGES = new Set(["react-compiler-runtime"]);

const hasCompilerPackage = (
  packageJson: PackageJson,
  compilerPackages: ReadonlySet<string>,
): boolean => {
  const allDependencies = {
    ...packageJson.peerDependencies,
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  return Object.keys(allDependencies).some((packageName) => compilerPackages.has(packageName));
};

const hasCompilerPackageInAncestors = (
  directory: string,
  compilerPackages: ReadonlySet<string>,
): boolean => {
  if (isProjectBoundary(directory)) return false;

  let ancestorDirectory = path.dirname(directory);
  while (ancestorDirectory !== path.dirname(ancestorDirectory)) {
    const ancestorPackagePath = path.join(ancestorDirectory, "package.json");
    if (isFile(ancestorPackagePath)) {
      const ancestorPackageJson = readPackageJson(ancestorPackagePath);
      if (hasCompilerPackage(ancestorPackageJson, compilerPackages)) return true;
    }
    if (isProjectBoundary(ancestorDirectory)) return false;
    ancestorDirectory = path.dirname(ancestorDirectory);
  }

  return false;
};

export const detectReactCompiler = (directory: string, packageJson: PackageJson): boolean =>
  hasCompilerPackage(packageJson, REACT_COMPILER_RUNTIME_PACKAGES) ||
  hasCompilerPackageInAncestors(directory, REACT_COMPILER_RUNTIME_PACKAGES) ||
  hasReactCompilerConfiguration(directory, packageJson) ||
  hasReactCompilerConfigurationInAncestors(directory);

export const detectReactCompilerLintPlugin = (
  directory: string,
  packageJson: PackageJson,
): boolean =>
  hasCompilerPackage(packageJson, REACT_COMPILER_LINT_PACKAGES) ||
  hasCompilerPackageInAncestors(directory, REACT_COMPILER_LINT_PACKAGES);
