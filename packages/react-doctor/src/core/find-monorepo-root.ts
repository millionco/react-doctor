import path from "node:path";
import { isFile } from "./is-file.js";
import { readPackageJson } from "./read-package-json.js";

export const isMonorepoRoot = (directory: string): boolean => {
  if (isFile(path.join(directory, "pnpm-workspace.yaml"))) return true;
  if (isFile(path.join(directory, "nx.json"))) return true;
  const packageJsonPath = path.join(directory, "package.json");
  if (!isFile(packageJsonPath)) return false;
  const packageJson = readPackageJson(packageJsonPath);
  return Array.isArray(packageJson.workspaces) || Boolean(packageJson.workspaces?.packages);
};

export const findMonorepoRoot = (startDirectory: string): string | null => {
  let currentDirectory = path.dirname(startDirectory);

  while (currentDirectory !== path.dirname(currentDirectory)) {
    if (isMonorepoRoot(currentDirectory)) return currentDirectory;
    currentDirectory = path.dirname(currentDirectory);
  }

  return null;
};
