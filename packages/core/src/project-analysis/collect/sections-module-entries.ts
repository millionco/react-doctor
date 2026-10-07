import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import fg from "fast-glob";
import { resolveEntryWithExtensions } from "../utils/resolve-entry-with-extensions.js";

const SECTIONS_FILE_GLOBS = ["sections.js", "**/sections.js"];

const CALYPSO_MODULE_PATTERN = /module:\s*['"]calypso\/([^'"]+)['"]/g;

const SECTION_BOOTSTRAP_SUFFIXES = [
  "",
  "/index",
  "/index.js",
  "/index.jsx",
  "/index.ts",
  "/index.tsx",
  "/main",
  "/controller",
  "/controller.js",
  "/controller.jsx",
];

const addSectionModuleEntry = (
  modulePath: string,
  projectRootDirectory: string,
  entries: Set<string>,
): void => {
  const normalizedModulePath = modulePath.replace(/^calypso\//, "");
  const moduleBasePath = resolve(projectRootDirectory, normalizedModulePath);

  for (const suffix of SECTION_BOOTSTRAP_SUFFIXES) {
    const candidatePath = suffix ? `${moduleBasePath}${suffix}` : moduleBasePath;
    const resolvedEntry = resolveEntryWithExtensions(candidatePath);
    if (resolvedEntry) entries.add(resolvedEntry);
  }
};

export const extractSectionsModuleEntries = (directory: string): string[] => {
  const entries = new Set<string>();

  const sectionsFilePaths = fg.sync(SECTIONS_FILE_GLOBS, {
    cwd: directory,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
    deep: 4,
  });

  for (const sectionsFilePath of sectionsFilePaths) {
    if (!sectionsFilePath.endsWith("/client/sections.js")) continue;

    try {
      const content = readFileSync(sectionsFilePath, "utf-8");
      let moduleMatch: RegExpExecArray | null;
      CALYPSO_MODULE_PATTERN.lastIndex = 0;
      while ((moduleMatch = CALYPSO_MODULE_PATTERN.exec(content)) !== null) {
        addSectionModuleEntry(moduleMatch[1], directory, entries);
      }
    } catch {
      continue;
    }
  }

  return [...entries];
};
