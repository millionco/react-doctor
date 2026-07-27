import * as path from "node:path";
import { RESOURCE_DEPENDENCY_SECTIONS } from "./constants.js";
import { createResourceHost } from "./create-resource-host.js";
import { createInMemoryResourceHostBackend } from "./in-memory-resource-host-backend.js";
import { isResourceWithinRoot } from "./is-resource-within-root.js";
import type {
  InMemoryResourceHostInput,
  InMemoryResourcePackageInput,
  ResourceHost,
  ResourcePackage,
} from "./resource-host.js";

interface NormalizedInMemoryResourcePackage {
  readonly resourcePackage: ResourcePackage;
  readonly installedDependencyVersions: Readonly<Record<string, string>>;
}

const normalizePackage = (
  resourceHost: ResourceHost,
  inputPackage: InMemoryResourcePackageInput,
): NormalizedInMemoryResourcePackage => {
  const directoryPath = resourceHost.normalizePath(inputPackage.directoryPath);
  return {
    resourcePackage: {
      directoryPath,
      manifestPath: resourceHost.normalizePath(path.join(directoryPath, "package.json")),
      manifest: inputPackage.manifest,
    },
    installedDependencyVersions: inputPackage.installedDependencyVersions ?? {},
  };
};

const findOwningPackage = (
  resourceHost: ResourceHost,
  packages: ReadonlyArray<NormalizedInMemoryResourcePackage>,
  filePath: string,
): NormalizedInMemoryResourcePackage | null => {
  const normalizedFilePath = resourceHost.normalizePath(filePath);
  let closestPackage: NormalizedInMemoryResourcePackage | null = null;
  for (const candidatePackage of packages) {
    if (!isResourceWithinRoot(candidatePackage.resourcePackage.directoryPath, normalizedFilePath)) {
      continue;
    }
    if (
      closestPackage === null ||
      candidatePackage.resourcePackage.directoryPath.length >
        closestPackage.resourcePackage.directoryPath.length
    ) {
      closestPackage = candidatePackage;
    }
  }
  return closestPackage;
};

export const createInMemoryResourceHost = (input: InMemoryResourceHostInput): ResourceHost => {
  const baseResourceHost = createResourceHost(createInMemoryResourceHostBackend(input));
  const packages: NormalizedInMemoryResourcePackage[] = [];
  for (const inputPackage of input.packages ?? []) {
    const normalizedPackage = normalizePackage(baseResourceHost, inputPackage);
    if (
      isResourceWithinRoot(
        baseResourceHost.rootDirectory,
        normalizedPackage.resourcePackage.directoryPath,
      )
    ) {
      packages.push(normalizedPackage);
    }
  }
  if (packages.length === 0) return baseResourceHost;

  const findPackageDescription = (filePath: string): NormalizedInMemoryResourcePackage | null =>
    findOwningPackage(baseResourceHost, packages, filePath);
  const findPackage = (filePath: string): ResourcePackage | null => {
    const describedPackage = findPackageDescription(filePath)?.resourcePackage ?? null;
    const fileBasedPackage = baseResourceHost.findOwningPackage(filePath);
    if (!describedPackage) return fileBasedPackage;
    if (!fileBasedPackage) return describedPackage;
    return describedPackage.directoryPath.length >= fileBasedPackage.directoryPath.length
      ? describedPackage
      : fileBasedPackage;
  };

  return {
    ...baseResourceHost,
    readManifest: (manifestPath) => {
      const normalizedManifestPath = baseResourceHost.normalizePath(manifestPath);
      const matchingPackage = packages.find(
        (candidatePackage) =>
          candidatePackage.resourcePackage.manifestPath === normalizedManifestPath,
      );
      return (
        matchingPackage?.resourcePackage.manifest ?? baseResourceHost.readManifest(manifestPath)
      );
    },
    findOwningPackage: findPackage,
    getDependency: (filePath, dependencyName) => {
      const describedPackage = findPackageDescription(filePath);
      const owningPackage = findPackage(filePath);
      if (
        !describedPackage ||
        !owningPackage ||
        describedPackage.resourcePackage.directoryPath !== owningPackage.directoryPath
      ) {
        return baseResourceHost.getDependency(filePath, dependencyName);
      }
      for (const section of RESOURCE_DEPENDENCY_SECTIONS) {
        const rawSpecifier = owningPackage.manifest[section]?.[dependencyName];
        if (typeof rawSpecifier !== "string") continue;
        return {
          name: dependencyName,
          packageDirectory: owningPackage.directoryPath,
          section,
          rawSpecifier,
          installedVersion: describedPackage.installedDependencyVersions[dependencyName] ?? null,
        };
      }
      return null;
    },
  };
};
