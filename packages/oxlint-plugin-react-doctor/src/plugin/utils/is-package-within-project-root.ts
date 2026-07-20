import * as fs from "node:fs";
import { normalizeFilename } from "./normalize-filename.js";

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

export const isPackageWithinProjectRoot = (
  packageDirectory: string,
  rootDirectory: string | undefined,
  includeRootDirectory: boolean,
): boolean => {
  if (rootDirectory === undefined || rootDirectory.length === 0) return false;
  const realPackageDirectory = normalizeFilename(resolveRealDirectory(packageDirectory));
  const normalizedRootDirectory = normalizeFilename(rootDirectory);
  if (includeRootDirectory && realPackageDirectory === normalizedRootDirectory) return true;
  const rootPrefix = normalizedRootDirectory.endsWith("/")
    ? normalizedRootDirectory
    : `${normalizedRootDirectory}/`;
  return realPackageDirectory.startsWith(rootPrefix);
};
