import fs from "node:fs";
import path from "node:path";
import { readPackageJson } from "./read-package-json.js";

export const isMonorepoRoot = (directory: string): boolean => {
  if (fs.existsSync(path.join(directory, "pnpm-workspace.yaml"))) return true;
  const packageJsonPath = path.join(directory, "package.json");
  if (!fs.existsSync(packageJsonPath)) return false;
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
