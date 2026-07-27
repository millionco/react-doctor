import * as path from "node:path";
import { isResourceWithinRoot } from "./is-resource-within-root.js";
import { normalizeResourcePath } from "./normalize-resource-path.js";
import type {
  InMemoryResourceHostInput,
  ResourceDirectoryEntry,
  ResourceHostBackend,
} from "./resource-host.js";

const addDirectoryAndAncestors = (
  directories: Set<string>,
  rootDirectory: string,
  directoryPath: string,
): void => {
  let currentDirectory = directoryPath;
  while (true) {
    directories.add(currentDirectory);
    if (currentDirectory === rootDirectory) return;
    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) return;
    currentDirectory = parentDirectory;
  }
};

export const createInMemoryResourceHostBackend = ({
  rootDirectory,
  files,
  directories: inputDirectories = [],
}: InMemoryResourceHostInput): ResourceHostBackend => {
  const normalizedRootDirectory = normalizeResourcePath(process.cwd(), rootDirectory);
  const normalizePath = (resourcePath: string): string =>
    normalizeResourcePath(normalizedRootDirectory, resourcePath);
  const normalizedFiles = new Map<string, string>();
  const directories = new Set<string>([normalizedRootDirectory]);

  for (const [filePath, sourceText] of files) {
    const normalizedFilePath = normalizePath(filePath);
    if (!isResourceWithinRoot(normalizedRootDirectory, normalizedFilePath)) continue;
    normalizedFiles.set(normalizedFilePath, sourceText);
    addDirectoryAndAncestors(
      directories,
      normalizedRootDirectory,
      path.dirname(normalizedFilePath),
    );
  }
  for (const directoryPath of inputDirectories) {
    const normalizedDirectoryPath = normalizePath(directoryPath);
    if (!isResourceWithinRoot(normalizedRootDirectory, normalizedDirectoryPath)) continue;
    addDirectoryAndAncestors(directories, normalizedRootDirectory, normalizedDirectoryPath);
  }

  return {
    rootDirectory: normalizedRootDirectory,
    normalizePath,
    readText: (filePath) => normalizedFiles.get(normalizePath(filePath)) ?? null,
    getPathKind: (resourcePath) => {
      const normalizedPath = normalizePath(resourcePath);
      if (normalizedFiles.has(normalizedPath)) return "file";
      if (directories.has(normalizedPath)) return "directory";
      return null;
    },
    readDirectory: (directoryPath) => {
      const normalizedDirectoryPath = normalizePath(directoryPath);
      if (!directories.has(normalizedDirectoryPath)) return [];
      const entriesByName = new Map<string, ResourceDirectoryEntry>();
      for (const filePath of normalizedFiles.keys()) {
        if (path.dirname(filePath) !== normalizedDirectoryPath) continue;
        const name = path.basename(filePath);
        entriesByName.set(name, { name, path: filePath, kind: "file" });
      }
      for (const childDirectoryPath of directories) {
        if (
          childDirectoryPath === normalizedDirectoryPath ||
          path.dirname(childDirectoryPath) !== normalizedDirectoryPath
        ) {
          continue;
        }
        const name = path.basename(childDirectoryPath);
        entriesByName.set(name, {
          name,
          path: childDirectoryPath,
          kind: "directory",
        });
      }
      return [...entriesByName.values()].toSorted((firstEntry, secondEntry) =>
        firstEntry.name.localeCompare(secondEntry.name),
      );
    },
  };
};
