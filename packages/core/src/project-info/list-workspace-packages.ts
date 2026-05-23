import path from "node:path";
import type { WorkspacePackage } from "../types/index.js";
import { isFile } from "./utils/is-file.js";
import { getWorkspacePatterns } from "./get-workspace-patterns.js";
import { hasReactDependency } from "./has-react-dependency.js";
import { readPackageJson } from "./read-package-json.js";
import { resolveWorkspaceDirectories } from "./resolve-workspace-directories.js";

export const listWorkspacePackages = (rootDirectory: string): WorkspacePackage[] => {
  const packageJsonPath = path.join(rootDirectory, "package.json");
  if (!isFile(packageJsonPath)) return [];

  const packageJson = readPackageJson(packageJsonPath);
  const patterns = getWorkspacePatterns(rootDirectory, packageJson);
  if (patterns.length === 0) return [];

  const packages: WorkspacePackage[] = [];
  // HACK: workspace pattern lists routinely contain overlapping globs
  // (e.g. cal.com's `["packages/*", "packages/app-store"]`). Without
  // dedup-by-directory the same package would surface twice in
  // discovery and downstream every diagnostic for it would be emitted
  // twice. The seen-set is keyed on the absolute directory path so
  // symbolic naming via package.json#name can't accidentally collapse
  // two genuinely-distinct directories.
  const seenDirectories = new Set<string>();
  const pushIfNew = (workspacePackage: WorkspacePackage): void => {
    if (seenDirectories.has(workspacePackage.directory)) return;
    seenDirectories.add(workspacePackage.directory);
    packages.push(workspacePackage);
  };

  if (hasReactDependency(packageJson)) {
    const rootName = packageJson.name ?? path.basename(rootDirectory);
    pushIfNew({ name: rootName, directory: rootDirectory });
  }

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);
    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));

      if (!hasReactDependency(workspacePackageJson)) continue;

      const name = workspacePackageJson.name ?? path.basename(workspaceDirectory);
      pushIfNew({ name, directory: workspaceDirectory });
    }
  }

  return packages;
};
