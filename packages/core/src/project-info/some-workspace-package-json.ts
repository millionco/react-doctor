import type { PackageJson } from "../types/index.js";
import { findInWorkspacePackageJsons } from "./find-in-workspace-package-jsons.js";

// True when the root manifest or any workspace package inside
// `rootDirectory` satisfies `predicate`. The boolean specialization of
// `findInWorkspacePackageJsons`, shared by the React Native and Reanimated
// project gates so both resolve workspaces identically.
export const someWorkspacePackageJson = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
  predicate: (packageJson: PackageJson) => boolean,
): boolean =>
  findInWorkspacePackageJsons(rootDirectory, rootPackageJson, (packageJson) =>
    predicate(packageJson) ? true : null,
  ) !== null;
