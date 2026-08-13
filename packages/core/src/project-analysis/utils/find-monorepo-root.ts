import { resolve, join, dirname } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { LOCKFILE_MARKERS, MONOREPO_ROOT_MARKERS } from "../constants.js";

const MAX_MONOREPO_WALK_DEPTH = 5;

export const findMonorepoRoot = (rootDir: string): string | undefined => {
  let currentDirectory = resolve(rootDir);
  let walkedDepth = 0;

  while (walkedDepth < MAX_MONOREPO_WALK_DEPTH) {
    const parentDirectory = dirname(currentDirectory);
    if (parentDirectory === currentDirectory) break;
    currentDirectory = parentDirectory;
    walkedDepth++;

    if (existsSync(join(currentDirectory, ".git"))) {
      for (const marker of MONOREPO_ROOT_MARKERS) {
        if (existsSync(join(currentDirectory, marker))) return currentDirectory;
      }

      const packageJsonPath = join(currentDirectory, "package.json");
      if (existsSync(packageJsonPath)) {
        try {
          const content = readFileSync(packageJsonPath, "utf-8");
          const packageJson = JSON.parse(content);
          if (packageJson.workspaces) return currentDirectory;
        } catch {
          // fall through
        }
      }

      for (const lockfile of LOCKFILE_MARKERS) {
        if (existsSync(join(currentDirectory, lockfile))) return currentDirectory;
      }

      return undefined;
    }

    for (const marker of MONOREPO_ROOT_MARKERS) {
      if (existsSync(join(currentDirectory, marker))) return currentDirectory;
    }

    const packageJsonPath = join(currentDirectory, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const content = readFileSync(packageJsonPath, "utf-8");
        const packageJson = JSON.parse(content);
        if (packageJson.workspaces) return currentDirectory;
      } catch {
        continue;
      }
    }

    for (const lockfile of LOCKFILE_MARKERS) {
      if (existsSync(join(currentDirectory, lockfile))) return currentDirectory;
    }
  }

  return undefined;
};
