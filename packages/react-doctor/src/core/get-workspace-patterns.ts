import type { PackageJson } from "../types/project-info.js";
import { getNxWorkspaceDirectories } from "./get-nx-workspace-directories.js";
import { parsePnpmWorkspacePatterns } from "./parse-pnpm-workspace-patterns.js";

export const getWorkspacePatterns = (rootDirectory: string, packageJson: PackageJson): string[] => {
  const pnpmPatterns = parsePnpmWorkspacePatterns(rootDirectory);
  if (pnpmPatterns.length > 0) return pnpmPatterns;

  if (Array.isArray(packageJson.workspaces)) {
    return packageJson.workspaces;
  }

  if (packageJson.workspaces?.packages) {
    return packageJson.workspaces.packages;
  }

  const nxPatterns = getNxWorkspaceDirectories(rootDirectory);
  if (nxPatterns.length > 0) return nxPatterns;

  return [];
};
