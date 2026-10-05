import * as path from "node:path";
import { parsePackageVersion, type ParsedPackageVersion } from "./parse-package-version.js";
import { comparePackageVersions } from "./compare-package-versions.js";
import { captureCrossFileProbes, replayCrossFileProbes } from "./cross-file-probe-recorder.js";
import type { CrossFileProbeTrace } from "./cross-file-probe-recorder.js";
import {
  findNearestPackageDirectory,
  getManifestCacheGeneration,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";

interface InstalledDependencyVersionResolution {
  didFindPackage: boolean;
  version: ParsedPackageVersion | null;
}

interface CachedDependencyVersionResolution {
  version: ParsedPackageVersion | null;
  trace: CrossFileProbeTrace;
}

const cachedDependencyVersionByPackageDirectory = new Map<
  string,
  CachedDependencyVersionResolution
>();
let cachedDependencyVersionGeneration = getManifestCacheGeneration();

const parseDeclaredLowerBound = (versionRange: unknown): ParsedPackageVersion | null => {
  if (typeof versionRange !== "string") return null;
  const trimmedRange = versionRange.trim();
  if (
    !trimmedRange ||
    /^(?:catalog|file|git|https?|link|npm|workspace):/.test(trimmedRange) ||
    /^(?:latest|next|\*)$/.test(trimmedRange)
  ) {
    return null;
  }

  const branchLowerBounds: ParsedPackageVersion[] = [];
  for (const rangeBranch of trimmedRange.split("||")) {
    const trimmedBranch = rangeBranch.trim();
    if (/^<(?!=)/.test(trimmedBranch) || /^<=/.test(trimmedBranch)) return null;
    const versionToken = trimmedBranch.match(/\d+(?:\.\d+)?(?:\.\d+)?(?:-[0-9A-Za-z.-]+)?/)?.[0];
    if (!versionToken) return null;
    const parsedVersion = parsePackageVersion(versionToken);
    if (!parsedVersion) return null;
    branchLowerBounds.push(parsedVersion);
  }
  return branchLowerBounds.reduce((lowestVersion, candidateVersion) =>
    comparePackageVersions(candidateVersion, lowestVersion) < 0 ? candidateVersion : lowestVersion,
  );
};

const getDeclaredDependencyVersion = (
  manifest: PackageManifest,
  packageName: string,
): ParsedPackageVersion | null =>
  parseDeclaredLowerBound(
    manifest.dependencies?.[packageName] ??
      manifest.devDependencies?.[packageName] ??
      manifest.peerDependencies?.[packageName] ??
      manifest.optionalDependencies?.[packageName],
  );

const findInstalledDependencyVersion = (
  packageDirectory: string,
  packageName: string,
): InstalledDependencyVersionResolution => {
  let currentDirectory = packageDirectory;
  while (true) {
    const installedManifest = readPackageManifest(
      path.join(currentDirectory, "node_modules", packageName),
    );
    if (installedManifest) {
      return {
        didFindPackage: true,
        version:
          typeof installedManifest.version === "string"
            ? parsePackageVersion(installedManifest.version)
            : null,
      };
    }
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return { didFindPackage: false, version: null };
    }
    currentDirectory = parentDirectory;
  }
};

const resolvePackageDependencyVersion = (
  packageDirectory: string,
  packageName: string,
): ParsedPackageVersion | null => {
  const installedVersionResolution = findInstalledDependencyVersion(packageDirectory, packageName);
  if (installedVersionResolution.didFindPackage) return installedVersionResolution.version;
  const owningManifest = readPackageManifest(packageDirectory);
  return owningManifest ? getDeclaredDependencyVersion(owningManifest, packageName) : null;
};

export const resolvePackageVersion = (
  filename: string | undefined,
  packageName: string,
): ParsedPackageVersion | null => {
  if (!filename) return null;
  const packageDirectory = findNearestPackageDirectory(path.resolve(filename));
  if (!packageDirectory) return null;
  const manifestCacheGeneration = getManifestCacheGeneration();
  if (manifestCacheGeneration !== cachedDependencyVersionGeneration) {
    cachedDependencyVersionByPackageDirectory.clear();
    cachedDependencyVersionGeneration = manifestCacheGeneration;
  }
  const cacheKey = JSON.stringify([packageDirectory, packageName]);
  const cached = cachedDependencyVersionByPackageDirectory.get(cacheKey);
  if (cached) {
    replayCrossFileProbes(cached.trace);
    return cached.version;
  }
  const { value: version, trace } = captureCrossFileProbes(() =>
    resolvePackageDependencyVersion(packageDirectory, packageName),
  );
  cachedDependencyVersionByPackageDirectory.set(cacheKey, { version, trace });
  return version;
};
