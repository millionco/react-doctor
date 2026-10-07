import type { EsTreeNode } from "./es-tree-node.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface ReExportTarget {
  importedName: string;
  source: string;
}

// Convenience: returns the source-side identifier name for an
// import specifier. Handles both `import { foo } from "..."` and
// `import { foo as localBar } from "..."` — returning "foo" in both
// cases. For default imports returns "default". For namespace
// imports returns null (caller should treat as opaque).
export const resolveImportedExportName = (importSpecifier: EsTreeNode): string | null => {
  if (isNodeOfType(importSpecifier, "ImportSpecifier")) {
    const imported = importSpecifier.imported;
    if (isNodeOfType(imported, "Identifier")) return imported.name;
    if (isNodeOfType(imported, "Literal") && typeof imported.value === "string") {
      return imported.value;
    }
    return null;
  }
  if (isNodeOfType(importSpecifier, "ImportDefaultSpecifier")) {
    return "default";
  }
  // ImportNamespaceSpecifier: the entire module's namespace. Cannot
  // map to a single exported name here.
  return null;
};

const namedReExportTargetForName = (
  statement: EsTreeNode,
  exportedName: string,
): ReExportTarget | null => {
  if (!isNodeOfType(statement, "ExportNamedDeclaration")) return null;
  if (!statement.source || statement.exportKind === "type") return null;
  const source = statement.source.value;
  if (typeof source !== "string") return null;
  for (const specifier of statement.specifiers ?? []) {
    const target = reExportTargetFromSpecifier(specifier, exportedName, source);
    if (target) return target;
  }
  return null;
};

const reExportTargetFromSpecifier = (
  specifier: EsTreeNode,
  exportedName: string,
  source: string,
): ReExportTarget | null => {
  if (!isNodeOfType(specifier, "ExportSpecifier")) return null;
  if (specifier.exportKind === "type") return null;
  if (getModuleSpecifierName(specifier.exported) !== exportedName) return null;
  const importedName = getModuleSpecifierName(specifier.local);
  return importedName ? { importedName, source } : null;
};

const exportAllTargetForName = (
  statement: EsTreeNode,
  exportedName: string,
): ReExportTarget | null => {
  if (!isNodeOfType(statement, "ExportAllDeclaration")) return null;
  if (!statement.source || statement.exportKind === "type" || statement.exported) return null;
  const source = statement.source.value;
  return typeof source === "string" ? { importedName: exportedName, source } : null;
};

// Returns the source/name pairs the caller should probe to resolve
// `exportedName` through a re-export, in priority order:
//
//   - A matching named re-export (`export { name } from "./x"`) is
//     precise, so the single matching source is returned on its own.
//   - Otherwise the name may live behind ANY `export * from "./x"`, so
//     every export-all source is returned for the caller to try in
//     turn (an earlier `export *` not containing the name shouldn't
//     stop the search).
//
// Empty when no re-export could carry the name.
export const findReExportTargetsForName = (
  programRoot: EsTreeNode,
  exportedName: string,
): ReadonlyArray<ReExportTarget> => {
  if (!isNodeOfType(programRoot, "Program")) return [];
  const exportAllTargets: ReExportTarget[] = [];
  for (const statement of programRoot.body ?? []) {
    const namedTarget = namedReExportTargetForName(statement, exportedName);
    if (namedTarget) return [namedTarget];
    const exportAllTarget = exportAllTargetForName(statement, exportedName);
    if (exportAllTarget) exportAllTargets.push(exportAllTarget);
  }
  return exportAllTargets;
};
