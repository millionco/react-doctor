import fg from "fast-glob";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { findMonorepoRoot } from "../utils/find-monorepo-root.js";
import { resolveWorkspaces } from "./workspaces.js";
import { resolveWorkspaceSubpath, trySourceFallback } from "../resolver/resolve.js";

const IMPORT_SPECIFIER_PATTERN =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)["']([^"'\n]+)["']/g;

const SIBLING_SOURCE_GLOB = "**/*.{ts,tsx,js,jsx,mts,mjs,cts,cjs}";

const SIBLING_STYLELINT_CONFIG_GLOBS = [
  "**/.stylelintrc.{js,cjs,mjs,ts,mts,cts}",
  "**/stylelint.config.{js,cjs,mjs,ts,mts,cts}",
];

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

const extractStylelintPluginSpecifiers = (sourceText: string): string[] => {
  const specifiers: string[] = [];
  const sourceFile = ts.createSourceFile(
    "stylelint.config.mjs",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const collectStringLiterals = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
      return;
    }
    ts.forEachChild(node, collectStringLiterals);
  };
  const visitNode = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      node.name.text === "plugins"
    ) {
      collectStringLiterals(node.initializer);
      return;
    }
    ts.forEachChild(node, visitNode);
  };
  visitNode(sourceFile);
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
  const addResolvedSpecifier = (specifier: string): void => {
    if (specifier !== packageName && !specifier.startsWith(`${packageName}/`)) return;
    const subpath = specifier.slice(packageName.length + 1);
    if (!subpath) return;
    const resolvedEntry = resolveWorkspaceSubpath(absoluteRoot, subpath);
    const sourceFallback = trySourceFallback(resolve(absoluteRoot, subpath));
    const importedEntry = resolvedEntry ?? sourceFallback;
    if (importedEntry) importedEntries.push(importedEntry);
  };

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
        addResolvedSpecifier(importSpecifier);
      }
    }

    const siblingStylelintConfigFiles = fg.sync(SIBLING_STYLELINT_CONFIG_GLOBS, {
      cwd: siblingDirectory,
      absolute: true,
      onlyFiles: true,
      dot: true,
      ignore: SIBLING_IGNORE_PATTERNS,
    });
    for (const siblingStylelintConfigFile of siblingStylelintConfigFiles) {
      let sourceText: string;
      try {
        sourceText = readFileSync(siblingStylelintConfigFile, "utf-8");
      } catch {
        continue;
      }
      if (!sourceText.includes(packageName)) continue;
      for (const configSpecifier of extractStylelintPluginSpecifiers(sourceText)) {
        addResolvedSpecifier(configSpecifier);
      }
    }
  }

  return [...new Set(importedEntries)];
};
