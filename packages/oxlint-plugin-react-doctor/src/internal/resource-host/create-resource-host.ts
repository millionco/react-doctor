import { parseResourceManifest } from "./parse-resource-manifest.js";
import { findOwningResourcePackage, getResourceDependency } from "./resolve-resource-package.js";
import {
  resolveResourceModuleFileFromAbsolutePath,
  resolveResourceImport,
  resolveResourceRelativeImport,
  resolveResourceTsconfigAlias,
} from "./resolve-resource-module.js";
import type { ResourceHost, ResourceHostBackend } from "./resource-host.js";

export const createResourceHost = (backend: ResourceHostBackend): ResourceHost => ({
  rootDirectory: backend.rootDirectory,
  normalizePath: backend.normalizePath,
  readSource: (filePath) => backend.readText(backend.normalizePath(filePath)),
  readManifest: (manifestPath) =>
    parseResourceManifest(backend.readText(backend.normalizePath(manifestPath))),
  getPathKind: (resourcePath) => backend.getPathKind(backend.normalizePath(resourcePath)),
  fileExists: (filePath) => backend.getPathKind(backend.normalizePath(filePath)) === "file",
  directoryExists: (directoryPath) =>
    backend.getPathKind(backend.normalizePath(directoryPath)) === "directory",
  listDirectory: (directoryPath, maximumEntries) => {
    const boundedMaximumEntries = Number.isFinite(maximumEntries)
      ? Math.max(0, Math.floor(maximumEntries))
      : 0;
    const directoryEntries = backend.readDirectory(backend.normalizePath(directoryPath));
    return {
      entries: directoryEntries.slice(0, boundedMaximumEntries),
      didReachLimit: directoryEntries.length > boundedMaximumEntries,
    };
  },
  resolveModuleFile: (absoluteModulePath) =>
    resolveResourceModuleFileFromAbsolutePath(backend, backend.normalizePath(absoluteModulePath)),
  resolveRelativeImport: (fromFilename, source) =>
    resolveResourceRelativeImport(backend, fromFilename, source),
  resolveTsconfigAlias: (fromFilename, source) =>
    resolveResourceTsconfigAlias(backend, fromFilename, source),
  resolveImport: (fromFilename, source) => resolveResourceImport(backend, fromFilename, source),
  findOwningPackage: (filePath) => findOwningResourcePackage(backend, filePath),
  getDependency: (filePath, dependencyName) =>
    getResourceDependency(backend, filePath, dependencyName),
});
