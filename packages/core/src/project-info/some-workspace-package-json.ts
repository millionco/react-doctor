import path from "node:path";
import type { PackageJson } from "../types/index.js";
import { getWorkspacePatterns } from "./get-workspace-patterns.js";
import { readPackageJson } from "./read-package-json.js";
import { resolveWorkspaceDirectories } from "./resolve-workspace-directories.js";

// True when the root manifest or any workspace package inside
// `rootDirectory` satisfies `predicate`. One short-circuiting walk of the
// workspace globs (`getWorkspacePatterns` + `resolveWorkspaceDirectories`),
// shared by the React Native and Reanimated project gates so both resolve
// workspaces identically.
export const someWorkspacePackageJson = (
  rootDirectory: string,
  rootPackageJson: PackageJson,
  predicate: (packageJson: PackageJson) => boolean,
): boolean => {
  if (predicate(rootPackageJson)) return true;

  const patterns = getWorkspacePatterns(rootDirectory, rootPackageJson);
  if (patterns.length === 0) return false;

  const visitedDirectories = new Set<string>();
  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);
    for (const workspaceDirectory of directories) {
      if (visitedDirectories.has(workspaceDirectory)) continue;
      visitedDirectories.add(workspaceDirectory);
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));
      if (predicate(workspacePackageJson)) return true;
    }
  }
  return false;
};
