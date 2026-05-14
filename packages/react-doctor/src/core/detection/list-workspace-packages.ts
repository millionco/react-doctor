import path from "node:path";
import type { WorkspacePackage } from "../../types.js";
import { isFile } from "../is-file.js";
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

  if (hasReactDependency(packageJson)) {
    const rootName = packageJson.name ?? path.basename(rootDirectory);
    packages.push({ name: rootName, directory: rootDirectory });
  }

  for (const pattern of patterns) {
    const directories = resolveWorkspaceDirectories(rootDirectory, pattern);
    for (const workspaceDirectory of directories) {
      const workspacePackageJson = readPackageJson(path.join(workspaceDirectory, "package.json"));

      if (!hasReactDependency(workspacePackageJson)) continue;

      const name = workspacePackageJson.name ?? path.basename(workspaceDirectory);
      packages.push({ name, directory: workspaceDirectory });
    }
  }

  return packages;
};
