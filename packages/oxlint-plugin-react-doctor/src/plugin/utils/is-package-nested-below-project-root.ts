import * as fs from "node:fs";
import { normalizeFilename } from "./normalize-filename.js";

// Symlink-tolerant directory comparison: core realpaths the settings
// `rootDirectory` (see `resolveSettingsRootDirectory`), while oxlint may
// hand rules pre-realpath filenames (macOS `/var` vs `/private/var`), so
// the package directory is realpathed too before comparing. Memoized per
// package directory — every file in a package shares the answer.
const cachedRealDirectoryByDirectory = new Map<string, string>();

const resolveRealDirectory = (directory: string): string => {
  const cached = cachedRealDirectoryByDirectory.get(directory);
  if (cached !== undefined) return cached;
  let realDirectory: string;
  try {
    realDirectory = fs.realpathSync(directory);
  } catch {
    realDirectory = directory;
  }
  cachedRealDirectoryByDirectory.set(directory, realDirectory);
  return realDirectory;
};

// A package manifest is authoritative for file-level framework gating
// when it sits BELOW the project root: in a monorepo, the framework
// capability comes from a sibling workspace, and this package's own
// manifest says what IT depends on — so framework rules must not apply
// to its files when the dependency is absent. At the project root the
// manifest is the same one the project-level framework hint was derived
// from, so the framework fallback stays in charge.
export const isPackageNestedBelowProjectRoot = (
  packageDirectory: string,
  rootDirectory: string | undefined,
): boolean => {
  if (rootDirectory === undefined || rootDirectory.length === 0) return false;
  const realPackageDirectory = normalizeFilename(resolveRealDirectory(packageDirectory));
  const normalizedRootDirectory = normalizeFilename(rootDirectory);
  const rootPrefix = normalizedRootDirectory.endsWith("/")
    ? normalizedRootDirectory
    : `${normalizedRootDirectory}/`;
  return realPackageDirectory.startsWith(rootPrefix);
};
