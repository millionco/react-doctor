import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const RESOLVABLE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".mts", ".cjs", ".cts"];

export const resolveEntryWithExtensions = (basePath: string): string | undefined => {
  if (existsSync(basePath)) return basePath;

  for (const extension of RESOLVABLE_EXTENSIONS) {
    const withExtension = basePath + extension;
    if (existsSync(withExtension)) return withExtension;
  }

  for (const extension of RESOLVABLE_EXTENSIONS) {
    const indexCandidate = join(basePath, `index${extension}`);
    if (existsSync(indexCandidate)) return indexCandidate;
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
