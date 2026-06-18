import type { PackageJson } from "../types/index.js";
import { findInWorkspacePackageJsons } from "./find-in-workspace-package-jsons.js";
import { getDependencySpec } from "./utils/get-dependency-spec.js";

export const findWorkspaceDependencySpec = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
  packageName: string,
): string | null =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, (packageJson) =>
    getDependencySpec(packageJson, packageName),
  );
