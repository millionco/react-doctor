import fs from "node:fs";
import path from "node:path";
import type { PackageJson } from "../types.js";

const cachedPackageJsons = new Map<string, PackageJson>();

// HACK: exposed so watch-mode / test-runner consumers can invalidate after
// the user edits a package.json file between repeated diagnose() calls.
export const clearPackageJsonCache = (): void => {
  cachedPackageJsons.clear();
};

const readPackageJsonUncached = (packageJsonPath: string): PackageJson => {
  try {
    return JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  } catch (error) {
    if (error instanceof SyntaxError) {
      return {};
    }
    if (error instanceof Error && "code" in error) {
      const { code } = error as { code: string };
      if (code === "EISDIR" || code === "EACCES") {
        return {};
      }
    }
    throw error;
  }
};

export const readPackageJson = (packageJsonPath: string): PackageJson => {
  const absolutePath = path.resolve(packageJsonPath);
  const cached = cachedPackageJsons.get(absolutePath);
  if (cached !== undefined) return cached;
  const result = readPackageJsonUncached(absolutePath);
  cachedPackageJsons.set(absolutePath, result);
  return result;
};
