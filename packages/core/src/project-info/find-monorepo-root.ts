import * as path from "node:path";
import { ancestorDirectories } from "../utils/ancestor-directories.js";
import { isFile } from "./utils/is-file.js";
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
  for (const directory of ancestorDirectories(startDirectory, { includeStart: false })) {
    if (isMonorepoRoot(directory)) return directory;
  }

  return null;
};
