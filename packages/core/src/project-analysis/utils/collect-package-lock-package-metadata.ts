import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import type { PackageLockPackageMetadata } from "../types.js";

export const collectPackageLockPackageMetadata = (
  searchRoots: ReadonlyArray<string>,
  resolutionDirectory: string,
  declaredDependencySpecifiers: Readonly<Record<string, string>>,
): Map<string, PackageLockPackageMetadata> => {
  const metadataByPackageName = new Map<string, PackageLockPackageMetadata>();
  for (const searchRoot of searchRoots) {
    const packageLockPath = join(searchRoot, "package-lock.json");
    if (!existsSync(packageLockPath)) continue;
    try {
      const packageLock = JSON.parse(readFileSync(packageLockPath, "utf8"));
      const packages = packageLock.packages;
      if (!packages || typeof packages !== "object") continue;
      const relativeResolutionDirectory = relative(searchRoot, resolutionDirectory).replaceAll(
        "\\",
        "/",
      );
      if (relativeResolutionDirectory.startsWith("../") || relativeResolutionDirectory === "..") {
        continue;
      }
      const resolutionPackageMetadata = packages[relativeResolutionDirectory];
      if (!resolutionPackageMetadata || typeof resolutionPackageMetadata !== "object") continue;
      const lockedDependencySpecifiers = {
        ...(resolutionPackageMetadata.dependencies ?? {}),
        ...(resolutionPackageMetadata.devDependencies ?? {}),
        ...(resolutionPackageMetadata.optionalDependencies ?? {}),
      };
      for (const [packageName, dependencySpecifier] of Object.entries(
        declaredDependencySpecifiers,
      )) {
        if (metadataByPackageName.has(packageName)) continue;
        if (lockedDependencySpecifiers[packageName] !== dependencySpecifier) continue;
        let packageMetadata;
        let candidateDirectory = relativeResolutionDirectory;
        while (true) {
          const candidatePath = candidateDirectory
            ? `${candidateDirectory}/node_modules/${packageName}`
            : `node_modules/${packageName}`;
          if (packages[candidatePath]) {
            packageMetadata = packages[candidatePath];
            break;
          }
          if (!candidateDirectory) break;
          const separatorIndex = candidateDirectory.lastIndexOf("/");
          candidateDirectory =
            separatorIndex === -1 ? "" : candidateDirectory.slice(0, separatorIndex);
        }
        if (packageMetadata && typeof packageMetadata === "object") {
          metadataByPackageName.set(packageName, packageMetadata);
        }
      }
    } catch {
      continue;
    }
  }
  return metadataByPackageName;
};
