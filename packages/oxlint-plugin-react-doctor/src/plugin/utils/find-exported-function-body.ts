import type { EsTreeNode } from "./es-tree-node.js";
import { findExportedValue } from "./find-exported-value.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface ReExportTarget {
  importedName: string;
  source: string;
}

// Given a parsed Program AST and an exported name, returns the
// function/arrow node bound to that export, or null if the export
// doesn't resolve to a function in this file. Handles:
//
//   export function reducer(state, action) {...}
//   export const reducer = (state, action) => {...}
//   export const reducer = function (state, action) {...}
//   export default function reducer(state, action) {...}
//   export default function (state, action) {...}              (exportedName === "default")
//   export default (state, action) => {...}                    (exportedName === "default")
//   function reducer(state, action) {...}; export { reducer };
//   const reducer = (...) => {...}; export { reducer };
//   export { reducer as default };                              (exportedName === "default")
//
// Re-exports (`export { reducer } from "./other"`,
// `export * from "./other"`) are NOT followed here — that's the
// barrel-following layer's job (see `resolve-barrel-export-file-path`).
// If a re-export is encountered the function returns null and the
// caller is expected to resolve the barrel separately.
export const findExportedFunctionBody = (
  programRoot: EsTreeNode,
  exportedName: string,
): EsTreeNode | null => {
  const exportedValue = findExportedValue(programRoot, exportedName);
  return isFunctionLike(exportedValue) ? exportedValue : null;
};

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
    if (isNodeOfType(statement, "ExportNamedDeclaration") && statement.source) {
      if (statement.exportKind === "type") continue;
      const sourceValue = statement.source.value;
      if (typeof sourceValue !== "string") continue;
      for (const specifier of statement.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
        if (specifier.exportKind === "type") continue;
        const exported = specifier.exported;
        const exportedNameSpec = isNodeOfType(exported, "Identifier")
          ? exported.name
          : isNodeOfType(exported, "Literal") && typeof exported.value === "string"
            ? exported.value
            : null;
        if (exportedNameSpec !== exportedName) continue;
        const local = specifier.local;
        const importedName = isNodeOfType(local, "Identifier")
          ? local.name
          : isNodeOfType(local, "Literal") && typeof local.value === "string"
            ? local.value
            : null;
        if (importedName) return [{ importedName, source: sourceValue }];
      }
    }
    if (isNodeOfType(statement, "ExportAllDeclaration") && statement.source) {
      if (statement.exportKind === "type" || statement.exported) continue;
      const sourceValue = statement.source.value;
      if (typeof sourceValue === "string") {
        exportAllTargets.push({ importedName: exportedName, source: sourceValue });
      }
    }
  }
  return exportAllTargets;
};
