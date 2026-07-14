import * as path from "node:path";
import type { EsTreeNode } from "./es-tree-node.js";
import { isEverySpecifierInlineType } from "./is-type-only-import.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveRelativeImportPath } from "./resolve-relative-import-path.js";

const getExportedName = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  if (isNodeOfType(node, "Identifier")) return node.name;
  if (isNodeOfType(node, "Literal") && typeof node.value === "string") return node.value;
  return null;
};

const programHasRuntimeNamedExports = (
  filePath: string,
  program: EsTreeNode,
  visitedFilePaths: Set<string>,
): boolean => {
  if (!isNodeOfType(program, "Program")) return true;
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) continue;
    if (isNodeOfType(statement, "ExportAllDeclaration")) {
      if (statement.exportKind === "type") continue;
      if (statement.exported) return true;
      if (typeof statement.source.value !== "string") return true;
      if (exportAllAddsRuntimeValues(filePath, statement.source.value, visitedFilePaths)) {
        return true;
      }
      continue;
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration")) continue;
    if (statement.exportKind === "type") continue;
    if (statement.declaration) {
      if (
        statement.declaration.type !== "TSInterfaceDeclaration" &&
        statement.declaration.type !== "TSTypeAliasDeclaration" &&
        statement.declaration.type !== "TSDeclareFunction"
      ) {
        return true;
      }
      continue;
    }
    if (isEverySpecifierInlineType(statement.specifiers, "ExportSpecifier", "exportKind")) {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (!isNodeOfType(specifier, "ExportSpecifier") || specifier.exportKind === "type") {
        continue;
      }
      if (getExportedName(specifier.exported) !== "default") return true;
    }
  }
  return false;
};

export const exportAllAddsRuntimeValues = (
  importerFilePath: string,
  source: string,
  visitedFilePaths = new Set<string>(),
): boolean => {
  const resolvedFilePath = resolveRelativeImportPath(importerFilePath, source);
  if (!resolvedFilePath) return true;
  if (path.extname(resolvedFilePath) === ".cjs" || resolvedFilePath.endsWith(".cts")) return true;
  if (visitedFilePaths.has(resolvedFilePath)) return true;
  visitedFilePaths.add(resolvedFilePath);
  const program = parseSourceFile(resolvedFilePath);
  if (!program) return true;
  return programHasRuntimeNamedExports(resolvedFilePath, program, visitedFilePaths);
};
