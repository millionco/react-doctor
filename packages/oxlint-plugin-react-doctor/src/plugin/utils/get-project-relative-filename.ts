import { normalizeFilename } from "./normalize-filename.js";

// Strips the project root prefix from an absolute filename. Returns the
// normalized filename unchanged when no root is provided or the file sits
// outside it.
export const getProjectRelativeFilename = (filename: string, rootDirectory?: string): string => {
  const normalizedFilename = normalizeFilename(filename);
  if (!rootDirectory) return normalizedFilename;

  const normalizedRootDirectory = normalizeFilename(rootDirectory).replace(/\/+$/, "");
  const rootDirectoryPrefix = `${normalizedRootDirectory}/`;
  if (!normalizedFilename.startsWith(rootDirectoryPrefix)) return normalizedFilename;

  return normalizedFilename.slice(rootDirectoryPrefix.length);
};
