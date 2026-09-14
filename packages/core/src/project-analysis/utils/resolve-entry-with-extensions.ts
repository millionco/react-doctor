import { statSync } from "node:fs";
import { join, resolve } from "node:path";

const RESOLVABLE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".cjs",
  ".cts",
  ".es6",
];

const isFile = (filePath: string): boolean => {
  try {
    return statSync(filePath, { throwIfNoEntry: false })?.isFile() ?? false;
  } catch {
    return false;
  }
};

export const resolveEntryWithExtensions = (basePath: string): string | undefined => {
  if (isFile(basePath)) return basePath;

  for (const extension of RESOLVABLE_EXTENSIONS) {
    const withExtension = basePath + extension;
    if (isFile(withExtension)) return withExtension;
  }

  for (const extension of RESOLVABLE_EXTENSIONS) {
    const indexCandidate = join(basePath, `index${extension}`);
    if (isFile(indexCandidate)) return indexCandidate;
  }

  return undefined;
};

export const resolveEntryPathWithExtensions = (
  entryPath: string,
  rootDirectory: string,
): string | undefined => {
  const absolutePath = resolve(rootDirectory, entryPath);
  return resolveEntryWithExtensions(absolutePath);
};
