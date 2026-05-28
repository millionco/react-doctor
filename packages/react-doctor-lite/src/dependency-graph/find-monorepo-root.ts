import * as fs from "node:fs";
import * as path from "node:path";
import { readPackageJson } from "./read-package-json.js";

const isMonorepoRoot = (directory: string): boolean => {
  if (fs.existsSync(path.join(directory, "pnpm-workspace.yaml"))) return true;
  const manifest = readPackageJson(directory);
  if (!manifest?.workspaces) return false;
  if (Array.isArray(manifest.workspaces)) return manifest.workspaces.length > 0;
  return Boolean(manifest.workspaces.packages?.length);
};

// Climbs ancestors from `startDirectory` looking for a workspace root so a
// leaf package inherits monorepo-wide dependencies. Returns the start
// directory itself when no enclosing workspace is found.
export const findMonorepoRoot = (startDirectory: string): string => {
  let current = path.resolve(startDirectory);
  while (true) {
    if (isMonorepoRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(startDirectory);
    current = parent;
  }
};
