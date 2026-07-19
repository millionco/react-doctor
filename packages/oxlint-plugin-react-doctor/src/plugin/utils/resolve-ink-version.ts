import * as path from "node:path";
import { INK_MODULE } from "../constants/ink.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import type { PackageManifest } from "./read-nearest-package-manifest.js";

interface ParsedPackageVersion {
  major: number;
  minor: number;
  patch: number;
  isPrerelease: boolean;
}

interface InstalledInkVersionResolution {
  didFindPackage: boolean;
  version: ParsedPackageVersion | null;
}

const parseVersionToken = (version: string): ParsedPackageVersion | null => {
  const match = version.match(
    /^(\d+)(?:\.(\d+))?(?:\.(\d+))?(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    isPrerelease: Boolean(match[4]),
  };
};

const compareVersions = (
  leftVersion: ParsedPackageVersion,
  rightVersion: ParsedPackageVersion,
): number =>
  leftVersion.major - rightVersion.major ||
  leftVersion.minor - rightVersion.minor ||
  leftVersion.patch - rightVersion.patch ||
  Number(rightVersion.isPrerelease) - Number(leftVersion.isPrerelease);

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
    const parsedVersion = parseVersionToken(versionToken);
    if (!parsedVersion) return null;
    branchLowerBounds.push(parsedVersion);
  }
  return branchLowerBounds.reduce((lowestVersion, candidateVersion) =>
    compareVersions(candidateVersion, lowestVersion) < 0 ? candidateVersion : lowestVersion,
  );
};

const getDeclaredInkVersion = (manifest: PackageManifest): ParsedPackageVersion | null =>
  parseDeclaredLowerBound(
    manifest.dependencies?.[INK_MODULE] ??
      manifest.devDependencies?.[INK_MODULE] ??
      manifest.peerDependencies?.[INK_MODULE] ??
      manifest.optionalDependencies?.[INK_MODULE],
  );

const findInstalledInkVersion = (packageDirectory: string): InstalledInkVersionResolution => {
  let currentDirectory = packageDirectory;
  while (true) {
    const installedManifest = readPackageManifest(
      path.join(currentDirectory, "node_modules", INK_MODULE),
    );
    if (installedManifest) {
      return {
        didFindPackage: true,
        version:
          typeof installedManifest.version === "string"
            ? parseVersionToken(installedManifest.version)
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

export const resolveInkVersion = (filename: string | undefined): ParsedPackageVersion | null => {
  if (!filename) return null;
  const packageDirectory = findNearestPackageDirectory(path.resolve(filename));
  if (!packageDirectory) return null;
  const installedVersionResolution = findInstalledInkVersion(packageDirectory);
  if (installedVersionResolution.didFindPackage) return installedVersionResolution.version;
  const owningManifest = readPackageManifest(packageDirectory);
  return owningManifest ? getDeclaredInkVersion(owningManifest) : null;
};

export const isInkVersionAtLeast = (
  filename: string | undefined,
  minimumVersion: string,
): boolean => {
  const resolvedVersion = resolveInkVersion(filename);
  const parsedMinimumVersion = parseVersionToken(minimumVersion);
  return Boolean(
    resolvedVersion &&
    parsedMinimumVersion &&
    compareVersions(resolvedVersion, parsedMinimumVersion) >= 0,
  );
};
