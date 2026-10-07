import * as path from "node:path";
import { getProjectRelativeFilename } from "./get-project-relative-filename.js";
import { normalizeFilename } from "./normalize-filename.js";

export const getProjectRelativeFilenameFromRoots = (
  filename: string,
  rootDirectories: ReadonlyArray<string>,
): string | null => {
  const normalizedFilename = normalizeFilename(filename);
  if (normalizedFilename.length === 0) return null;
  if (!path.isAbsolute(filename)) return normalizedFilename;

  for (const rootDirectory of rootDirectories) {
    const relativeFilename = getProjectRelativeFilename(normalizedFilename, rootDirectory);
    if (relativeFilename !== normalizedFilename) return relativeFilename;
  }

  return null;
};
