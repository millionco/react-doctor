import * as path from "node:path";
import type { PackageJson } from "../types/index.js";
import { getWorkspacePatterns } from "./get-workspace-patterns.js";
import { readPackageJson } from "./read-package-json.js";
import { resolveWorkspaceDirectories } from "./resolve-workspace-directories.js";

// First non-null value produced by `select` over the root manifest and
// then each workspace package inside `rootDirectory`. One short-circuiting
// walk of the workspace globs (`getWorkspacePatterns` +
// `resolveWorkspaceDirectories`), shared by `someWorkspacePackageJson` (its
// boolean specialization) and the value-returning gates (e.g.
// `findExpoVersion`) so every workspace gate resolves packages identically.
export const findInWorkspacePackageJsons = <Value>(
  rootDirectory: string,
  rootPackageJson: PackageJson,
  select: (packageJson: PackageJson) => Value | null,
): Value | null => {
  const rootValue = select(rootPackageJson);
  if (rootValue !== null) return rootValue;

  const patterns = getWorkspacePatterns(rootDirectory, rootPackageJson);
  if (patterns.length === 0) return null;

  const visitedDirectories = new Set<string>();
  for (const pattern of patterns) {
    // Sort so the first non-null value is stable across runs — the raw order
    // comes from `readdir`, which isn't guaranteed consistent, and the
    // value-returning gates (e.g. `findExpoVersion`) must not return a
    // different workspace's spec on repeated analysis of the same tree.
    const directories = [...resolveWorkspaceDirectories(rootDirectory, pattern)].sort();
    for (const workspaceDirectory of directories) {
      if (visitedDirectories.has(workspaceDirectory)) continue;
      visitedDirectories.add(workspaceDirectory);
      const value = select(readPackageJson(path.join(workspaceDirectory, "package.json")));
      if (value !== null) return value;
    }
  }
  return null;
};
