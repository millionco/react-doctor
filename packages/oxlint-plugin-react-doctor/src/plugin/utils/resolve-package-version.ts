import * as path from "node:path";
import * as fs from "node:fs";
import { parsePackageVersion, type ParsedPackageVersion } from "./parse-package-version.js";
import { comparePackageVersions } from "./compare-package-versions.js";
import {
  captureCrossFileProbes,
  replayCrossFileProbes,
  recordExistenceProbe,
} from "./cross-file-probe-recorder.js";
import type { CrossFileProbeTrace } from "./cross-file-probe-recorder.js";
import {
  findNearestPackageDirectory,
  getManifestCacheGeneration,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";

export interface ResolvePackageVersionOptions {
  readonly rejectInvalidResolvedManifest?: boolean;
}

export interface ResolvedPackageVersion {
  version: ParsedPackageVersion;
  declaredRange: string | null;
}

interface InstalledDependencyVersionResolution {
  didFindPackage: boolean;
  version: ParsedPackageVersion | null;
}

interface CachedDependencyVersionResolution {
  version: ResolvedPackageVersion | null;
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
): ResolvedPackageVersion | null => {
  const declaredRange =
    manifest.dependencies?.[packageName] ??
    manifest.devDependencies?.[packageName] ??
    manifest.peerDependencies?.[packageName] ??
    manifest.optionalDependencies?.[packageName];
  const version = parseDeclaredLowerBound(declaredRange);
  return version && typeof declaredRange === "string" ? { version, declaredRange } : null;
};

const findInstalledDependencyVersion = (
  packageDirectory: string,
  packageName: string,
  rejectInvalidResolvedManifest: boolean,
): InstalledDependencyVersionResolution => {
  let currentDirectory = packageDirectory;
  while (true) {
    const dependencyDirectory = path.join(currentDirectory, "node_modules", packageName);
    let hasResolvedManifest = false;
    if (rejectInvalidResolvedManifest) {
      const manifestPath = path.join(dependencyDirectory, "package.json");
      recordExistenceProbe(manifestPath);
      try {
        const manifestEntry = fs.statSync(manifestPath, { throwIfNoEntry: false });
        hasResolvedManifest = Boolean(manifestEntry?.isFile() || manifestEntry?.isDirectory());
      } catch {
        hasResolvedManifest = false;
      }
    }
    const installedManifest = readPackageManifest(dependencyDirectory);
    if (installedManifest) {
      return {
        didFindPackage: true,
        version:
          typeof installedManifest.version === "string"
            ? parsePackageVersion(installedManifest.version)
            : null,
      };
    }
    if (hasResolvedManifest) return { didFindPackage: true, version: null };
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
  rejectInvalidResolvedManifest: boolean,
): ResolvedPackageVersion | null => {
  const installedVersionResolution = findInstalledDependencyVersion(
    packageDirectory,
    packageName,
    rejectInvalidResolvedManifest,
  );
  if (installedVersionResolution.didFindPackage) {
    return installedVersionResolution.version
      ? { version: installedVersionResolution.version, declaredRange: null }
      : null;
  }
  const owningManifest = readPackageManifest(packageDirectory);
  return owningManifest ? getDeclaredDependencyVersion(owningManifest, packageName) : null;
};

export const resolvePackageVersion = (
  filename: string | undefined,
  packageName: string,
  options: ResolvePackageVersionOptions = {},
): ResolvedPackageVersion | null => {
  if (!filename) return null;
  const packageDirectory = findNearestPackageDirectory(path.resolve(filename));
  if (!packageDirectory) return null;
  const manifestCacheGeneration = getManifestCacheGeneration();
  if (manifestCacheGeneration !== cachedDependencyVersionGeneration) {
    cachedDependencyVersionByPackageDirectory.clear();
    cachedDependencyVersionGeneration = manifestCacheGeneration;
  }
  const rejectInvalidResolvedManifest = options.rejectInvalidResolvedManifest === true;
  const cacheKey = JSON.stringify([packageDirectory, packageName, rejectInvalidResolvedManifest]);
  const cached = cachedDependencyVersionByPackageDirectory.get(cacheKey);
  if (cached) {
    replayCrossFileProbes(cached.trace);
    return cached.version;
  }
  const { value: version, trace } = captureCrossFileProbes(() =>
    resolvePackageDependencyVersion(packageDirectory, packageName, rejectInvalidResolvedManifest),
  );
  cachedDependencyVersionByPackageDirectory.set(cacheKey, { version, trace });
  return version;
};
