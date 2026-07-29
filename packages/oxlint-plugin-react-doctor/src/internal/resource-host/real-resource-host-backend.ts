import * as fs from "node:fs";
import * as path from "node:path";
import {
  recordContentProbe,
  recordExistenceProbe,
} from "../../plugin/utils/cross-file-probe-recorder.js";
import { isResourceWithinRoot } from "./is-resource-within-root.js";
import { normalizeResourcePath } from "./normalize-resource-path.js";
import type {
  RealFilesystemResourceHostInput,
  ResourceDirectoryEntry,
  ResourceHostBackend,
} from "./resource-host.js";

const getDirectoryEntryKind = (directoryEntry: fs.Dirent): ResourceDirectoryEntry["kind"] => {
  if (directoryEntry.isFile()) return "file";
  if (directoryEntry.isDirectory()) return "directory";
  return "other";
};

export const createRealResourceHostBackend = ({
  rootDirectory,
}: RealFilesystemResourceHostInput): ResourceHostBackend => {
  const normalizedRootDirectory = normalizeResourcePath(process.cwd(), rootDirectory);
  const normalizePath = (resourcePath: string): string =>
    normalizeResourcePath(normalizedRootDirectory, resourcePath);

  return {
    rootDirectory: normalizedRootDirectory,
    normalizePath,
    readText: (filePath) => {
      const normalizedFilePath = normalizePath(filePath);
      if (!isResourceWithinRoot(normalizedRootDirectory, normalizedFilePath)) return null;
      recordContentProbe(normalizedFilePath);
      try {
        return fs.readFileSync(normalizedFilePath, "utf8");
      } catch {
        return null;
      }
    },
    getPathKind: (resourcePath) => {
      const normalizedPath = normalizePath(resourcePath);
      if (!isResourceWithinRoot(normalizedRootDirectory, normalizedPath)) return null;
      recordExistenceProbe(normalizedPath);
      try {
        const resourceStat = fs.statSync(normalizedPath);
        if (resourceStat.isFile()) return "file";
        if (resourceStat.isDirectory()) return "directory";
        return "other";
      } catch {
        return null;
      }
    },
    readDirectory: (directoryPath) => {
      const normalizedDirectoryPath = normalizePath(directoryPath);
      if (!isResourceWithinRoot(normalizedRootDirectory, normalizedDirectoryPath)) return [];
      recordExistenceProbe(normalizedDirectoryPath);
      try {
        return fs
          .readdirSync(normalizedDirectoryPath, { withFileTypes: true })
          .map((directoryEntry) => ({
            name: directoryEntry.name,
            path: normalizePath(path.join(normalizedDirectoryPath, directoryEntry.name)),
            kind: getDirectoryEntryKind(directoryEntry),
          }))
          .toSorted((firstEntry, secondEntry) => firstEntry.name.localeCompare(secondEntry.name));
      } catch {
        return [];
      }
    },
  };
};

const realResourceHostBackendsByRoot = new Map<string, ResourceHostBackend>();

export const getRealResourceHostBackend = (resourcePath: string): ResourceHostBackend => {
  const absoluteResourcePath = path.resolve(resourcePath);
  const rootDirectory = path.parse(absoluteResourcePath).root;
  const cachedBackend = realResourceHostBackendsByRoot.get(rootDirectory);
  if (cachedBackend) return cachedBackend;
  const backend = createRealResourceHostBackend({ rootDirectory });
  realResourceHostBackendsByRoot.set(rootDirectory, backend);
  return backend;
};
