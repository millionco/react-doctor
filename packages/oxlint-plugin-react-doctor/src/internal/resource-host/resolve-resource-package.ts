import * as path from "node:path";
import { RESOURCE_DEPENDENCY_SECTIONS } from "./constants.js";
import { isResourceWithinRoot } from "./is-resource-within-root.js";
import { parseResourceManifest } from "./parse-resource-manifest.js";
import type { ResourceDependency, ResourceHostBackend, ResourcePackage } from "./resource-host.js";

const readResourcePackage = (
  backend: ResourceHostBackend,
  packageDirectory: string,
): ResourcePackage | null => {
  const normalizedPackageDirectory = backend.normalizePath(packageDirectory);
  const manifestPath = backend.normalizePath(path.join(normalizedPackageDirectory, "package.json"));
  const manifest = parseResourceManifest(backend.readText(manifestPath));
  return manifest
    ? {
        directoryPath: normalizedPackageDirectory,
        manifestPath,
        manifest,
      }
    : null;
};

export const findOwningResourcePackage = (
  backend: ResourceHostBackend,
  filePath: string,
): ResourcePackage | null => {
  let currentDirectory = path.dirname(backend.normalizePath(filePath));
  while (isResourceWithinRoot(backend.rootDirectory, currentDirectory)) {
    const manifestPath = backend.normalizePath(path.join(currentDirectory, "package.json"));
    if (backend.getPathKind(manifestPath) === "file") {
      return readResourcePackage(backend, currentDirectory);
    }
    if (currentDirectory === backend.rootDirectory) return null;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
  return null;
};

const findInstalledDependencyVersion = (
  backend: ResourceHostBackend,
  packageDirectory: string,
  dependencyName: string,
): string | null => {
  let currentDirectory = backend.normalizePath(packageDirectory);
  while (isResourceWithinRoot(backend.rootDirectory, currentDirectory)) {
    const installedManifest = parseResourceManifest(
      backend.readText(
        backend.normalizePath(
          path.join(currentDirectory, "node_modules", dependencyName, "package.json"),
        ),
      ),
    );
    if (typeof installedManifest?.version === "string") return installedManifest.version;
    if (currentDirectory === backend.rootDirectory) return null;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return null;
    currentDirectory = parentDirectory;
  }
  return null;
};

export const getResourceDependency = (
  backend: ResourceHostBackend,
  filePath: string,
  dependencyName: string,
): ResourceDependency | null => {
  const owningPackage = findOwningResourcePackage(backend, filePath);
  if (!owningPackage) return null;

  for (const dependencySection of RESOURCE_DEPENDENCY_SECTIONS) {
    const rawSpecifier = owningPackage.manifest[dependencySection]?.[dependencyName];
    if (typeof rawSpecifier !== "string") continue;
    return {
      name: dependencyName,
      packageDirectory: owningPackage.directoryPath,
      section: dependencySection,
      rawSpecifier,
      installedVersion: findInstalledDependencyVersion(
        backend,
        owningPackage.directoryPath,
        dependencyName,
      ),
    };
  }
  return null;
};
