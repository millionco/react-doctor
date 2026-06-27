// HACK: kept standalone (not folded into dependencies.ts) to break an import
// cycle — both detectors.ts and dependencies.ts import readPackageJson.
import * as fs from "node:fs";
import * as path from "node:path";
import type { PackageJson } from "../types/index.js";
import { isErrnoException } from "../utils/is-errno-exception.js";

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
    if (isErrnoException(error)) {
      const { code } = error;
      // EISDIR — packageJsonPath unexpectedly pointed at a directory.
      // EACCES / EPERM — POSIX denial and macOS TCC denial respectively
      // (e.g., a package.json inside ~/Library/Accounts when the scan
      // root is $HOME). ENOENT — file disappeared between the isFile()
      // probe upstream and this read (race during long walks).
      if (code === "EISDIR" || code === "EACCES" || code === "EPERM" || code === "ENOENT") {
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
