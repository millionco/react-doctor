import { getCurrentResourceHost } from "../../internal/resource-host/resource-host-context.js";
import { normalizeFilename } from "./normalize-filename.js";
import { resolveRealPath } from "./resolve-real-path.js";

const cachedRealDirectoryByDirectory = new Map<string, string>();

const resolveRealDirectory = (directory: string): string => {
  const cached = cachedRealDirectoryByDirectory.get(directory);
  if (cached !== undefined) return cached;
  const realDirectory = resolveRealPath(directory);
  cachedRealDirectoryByDirectory.set(directory, realDirectory);
  return realDirectory;
};

export const isPackageWithinProjectRoot = (
  packageDirectory: string,
  rootDirectory: string | undefined,
  includeRootDirectory: boolean,
): boolean => {
  if (rootDirectory === undefined || rootDirectory.length === 0) return false;
  const currentResourceHost = getCurrentResourceHost();
  if (currentResourceHost) {
    const normalizedPackageDirectory = currentResourceHost.normalizePath(packageDirectory);
    const normalizedRootDirectory = currentResourceHost.normalizePath(rootDirectory);
    if (includeRootDirectory && normalizedPackageDirectory === normalizedRootDirectory) return true;
    const rootPrefix = normalizedRootDirectory.endsWith("/")
      ? normalizedRootDirectory
      : `${normalizedRootDirectory}/`;
    return normalizedPackageDirectory.startsWith(rootPrefix);
  }
  const realPackageDirectory = normalizeFilename(resolveRealDirectory(packageDirectory));
  const normalizedRootDirectory = normalizeFilename(rootDirectory);
  if (includeRootDirectory && realPackageDirectory === normalizedRootDirectory) return true;
  const rootPrefix = normalizedRootDirectory.endsWith("/")
    ? normalizedRootDirectory
    : `${normalizedRootDirectory}/`;
  return realPackageDirectory.startsWith(rootPrefix);
};
