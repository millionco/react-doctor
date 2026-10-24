import * as fs from "node:fs";
import * as path from "node:path";
import { isTestlikeFilename, isTestNoiseFilename } from "./is-testlike-filename.js";
import { normalizeFilename } from "./normalize-filename.js";

export interface ProductionSourceFileLimits {
  readonly maxEntryCount: number;
  readonly maxFileCount: number;
  readonly maxFileSizeBytes: number;
  readonly maxTotalBytes: number;
}

export interface ProductionSourceFiles {
  readonly sourceFilePaths: ReadonlyArray<string>;
  readonly htmlFilePaths: ReadonlyArray<string>;
  readonly hasOpaqueMdxConsumerSurface: boolean;
}

export const SOURCE_PROJECT_FILE_PATTERN = /\.[cm]?[jt]sx?$/i;
const SOURCE_PROJECT_DECLARATION_FILE_PATTERN = /\.d\.[cm]?[jt]s$/i;
const SOURCE_PROJECT_MDX_FILE_PATTERN = /\.mdx$/i;
const SOURCE_PROJECT_HTML_FILE_PATTERN = /\.html?$/i;
const SOURCE_PROJECT_IGNORED_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".angular",
  ".astro",
  ".cache",
  ".contentlayer",
  ".docusaurus",
  ".expo",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".turbo",
  ".vercel",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "storybook-static",
]);
export const listProductionSourceFiles = (
  rootDirectory: string,
  limits?: ProductionSourceFileLimits,
  includeApplicationDirectories = false,
): ProductionSourceFiles | null => {
  const sourceFilePaths: string[] = [];
  const htmlFilePaths: string[] = [];
  const pendingDirectories = [rootDirectory];
  let hasOpaqueMdxConsumerSurface = false;
  let entryCount = 0;
  let sourceBytes = 0;

  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (!currentDirectory) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDirectory, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      entryCount++;
      if (limits && entryCount > limits.maxEntryCount) return null;
      const absolutePath = path.join(currentDirectory, entry.name);
      const isIgnoredDirectoryName =
        SOURCE_PROJECT_IGNORED_DIRECTORY_NAMES.has(entry.name) ||
        (entry.name.startsWith(".") && entry.name !== ".dumi" && entry.name !== ".storybook");
      if (entry.isSymbolicLink() && isIgnoredDirectoryName) continue;
      if (entry.isSymbolicLink()) return null;
      if (entry.isDirectory()) {
        if (isIgnoredDirectoryName) continue;
        pendingDirectories.push(absolutePath);
        continue;
      }
      if (
        !entry.isFile() ||
        (includeApplicationDirectories
          ? isTestNoiseFilename(absolutePath)
          : isTestlikeFilename(absolutePath))
      )
        continue;
      if (SOURCE_PROJECT_MDX_FILE_PATTERN.test(entry.name)) {
        hasOpaqueMdxConsumerSurface = true;
        continue;
      }
      if (SOURCE_PROJECT_HTML_FILE_PATTERN.test(entry.name)) {
        htmlFilePaths.push(normalizeFilename(absolutePath));
        continue;
      }
      if (!SOURCE_PROJECT_FILE_PATTERN.test(entry.name)) continue;
      if (SOURCE_PROJECT_DECLARATION_FILE_PATTERN.test(entry.name)) continue;
      if (limits) {
        try {
          const fileStat = fs.lstatSync(absolutePath);
          if (!fileStat.isFile() || fileStat.size > limits.maxFileSizeBytes) return null;
          sourceBytes += fileStat.size;
          if (sourceBytes > limits.maxTotalBytes) return null;
        } catch {
          return null;
        }
        if (sourceFilePaths.length >= limits.maxFileCount) return null;
      }
      sourceFilePaths.push(normalizeFilename(absolutePath));
    }
  }

  return { sourceFilePaths, htmlFilePaths, hasOpaqueMdxConsumerSurface };
};
