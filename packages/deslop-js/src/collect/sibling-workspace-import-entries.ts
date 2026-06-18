import fg from "fast-glob";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";
import { resolveWorkspaces } from "./workspaces.js";
import { resolveWorkspaceSubpath, trySourceFallback } from "../resolver/resolve.js";

const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']/g;

const SIBLING_SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";

const SIBLING_IGNORE_PATTERNS = ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.git/**"];

const readPackageName = (directory: string): string | undefined => {
  try {
    const content = readFileSync(join(directory, "package.json"), "utf-8");
    const packageJson = JSON.parse(content);
    return typeof packageJson.name === "string" ? packageJson.name : undefined;
  } catch {
    return undefined;
  }
};

const extractImportSpecifiers = (sourceText: string): string[] => {
  const specifiers: string[] = [];
  for (const specifierMatch of sourceText.matchAll(IMPORT_SPECIFIER_PATTERN)) {
    specifiers.push(specifierMatch[1]);
  }
  return specifiers;
};

export const extractSiblingWorkspaceImportEntries = (absoluteRoot: string): string[] => {
  const monorepoRoot = findMonorepoRoot(absoluteRoot);
  if (!monorepoRoot || monorepoRoot === absoluteRoot) return [];

  const packageName = readPackageName(absoluteRoot);
  if (!packageName) return [];

  const siblingDirectories = resolveWorkspaces(monorepoRoot)
    .packages.map((workspacePackage) => workspacePackage.directory)
    .filter(
      (workspaceDirectory) =>
        workspaceDirectory !== absoluteRoot &&
        !workspaceDirectory.startsWith(`${absoluteRoot}/`) &&
        !absoluteRoot.startsWith(`${workspaceDirectory}/`),
    );
  if (siblingDirectories.length === 0) return [];

  const importedEntries: string[] = [];
  for (const siblingDirectory of siblingDirectories) {
    const siblingSourceFiles = fg.sync(SIBLING_SOURCE_GLOB, {
      cwd: siblingDirectory,
      absolute: true,
      onlyFiles: true,
      ignore: SIBLING_IGNORE_PATTERNS,
    });

    for (const siblingSourceFile of siblingSourceFiles) {
      let sourceText: string;
      try {
        sourceText = readFileSync(siblingSourceFile, "utf-8");
      } catch {
        continue;
      }
      if (!sourceText.includes(packageName)) continue;

      for (const importSpecifier of extractImportSpecifiers(sourceText)) {
        if (importSpecifier !== packageName && !importSpecifier.startsWith(`${packageName}/`)) {
          continue;
        }
        const subpath = importSpecifier.slice(packageName.length + 1);
        if (!subpath) continue;
        const resolvedEntry = resolveWorkspaceSubpath(absoluteRoot, subpath);
        if (resolvedEntry) {
          importedEntries.push(trySourceFallback(resolvedEntry) ?? resolvedEntry);
        }
      }
    }
  }

  return [...new Set(importedEntries)];
};
