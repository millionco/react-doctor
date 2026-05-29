import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isFunctionLike = (
  node: EsTreeNode | null | undefined,
): node is
  | EsTreeNodeOfType<"FunctionDeclaration">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"ArrowFunctionExpression"> => {
  if (!node) return false;
  return (
    isNodeOfType(node, "FunctionDeclaration") ||
    isNodeOfType(node, "FunctionExpression") ||
    isNodeOfType(node, "ArrowFunctionExpression")
  );
};

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
  if (!isNodeOfType(programRoot, "Program")) return null;

  const localBindings = new Map<string, EsTreeNode>();
  const namedExports = new Map<string, string>();
  let defaultExport: EsTreeNode | null = null;
  // `export default someIdentifier` — resolved after all local bindings
  // are gathered (the identifier may be declared later in the file).
  let defaultExportIdentifierName: string | null = null;

  const recordVariableDeclaration = (declaration: EsTreeNodeOfType<"VariableDeclaration">) => {
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      if (!isNodeOfType(declarator.id, "Identifier")) continue;
      const initializer = declarator.init ? stripParenExpression(declarator.init) : null;
      if (initializer && isFunctionLike(initializer)) {
        localBindings.set(declarator.id.name, initializer);
      }
    }
  };

  for (const statement of programRoot.body ?? []) {
    if (isNodeOfType(statement, "VariableDeclaration")) {
      recordVariableDeclaration(statement);
      continue;
    }
    if (isNodeOfType(statement, "FunctionDeclaration") && statement.id) {
      localBindings.set(statement.id.name, statement);
      continue;
    }

    if (isNodeOfType(statement, "ExportNamedDeclaration")) {
      const declaration = statement.declaration;
      if (declaration && isNodeOfType(declaration, "VariableDeclaration")) {
        recordVariableDeclaration(declaration);
        for (const declarator of declaration.declarations ?? []) {
          if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
          if (!isNodeOfType(declarator.id, "Identifier")) continue;
          namedExports.set(declarator.id.name, declarator.id.name);
        }
      } else if (
        declaration &&
        isNodeOfType(declaration, "FunctionDeclaration") &&
        declaration.id
      ) {
        localBindings.set(declaration.id.name, declaration);
        namedExports.set(declaration.id.name, declaration.id.name);
      }
      for (const specifier of statement.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
        const local = specifier.local;
        const exported = specifier.exported;
        if (!isNodeOfType(local, "Identifier")) continue;
        const exportedNameSpec = isNodeOfType(exported, "Identifier")
          ? exported.name
          : isNodeOfType(exported, "Literal") && typeof exported.value === "string"
            ? exported.value
            : null;
        if (!exportedNameSpec) continue;
        namedExports.set(exportedNameSpec, local.name);
      }
      continue;
    }

    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      const declaration = statement.declaration;
      if (!declaration) continue;
      if (isNodeOfType(declaration, "FunctionDeclaration") && declaration.id) {
        localBindings.set(declaration.id.name, declaration);
        defaultExport = declaration;
        continue;
      }
      if (isFunctionLike(declaration)) {
        defaultExport = declaration;
        continue;
      }
      if (isNodeOfType(declaration, "Identifier")) {
        // Resolved lazily below — we need to wait until all local
        // bindings are gathered.
        defaultExportIdentifierName = declaration.name;
        continue;
      }
    }
  }

  if (exportedName === "default") {
    if (defaultExport) return defaultExport;
    if (defaultExportIdentifierName) {
      const binding = localBindings.get(defaultExportIdentifierName);
      if (binding) return binding;
    }
    // `export { reducer as default }` — the specifier loop above
    // recorded `namedExports.set("default", "reducer")`. Fall
    // through to the general lookup so the rename-as-default shape
    // resolves correctly.
  }

  const localName = namedExports.get(exportedName);
  if (!localName) return null;
  return localBindings.get(localName) ?? null;
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

// Returns the relative `source` strings the caller should probe to
// resolve `exportedName` through a re-export, in priority order:
//
//   - A matching named re-export (`export { name } from "./x"`) is
//     precise, so the single matching source is returned on its own.
//   - Otherwise the name may live behind ANY `export * from "./x"`, so
//     every export-all source is returned for the caller to try in
//     turn (an earlier `export *` not containing the name shouldn't
//     stop the search).
//
// Empty when no re-export could carry the name.
export const findReExportSourcesForName = (
  programRoot: EsTreeNode,
  exportedName: string,
): string[] => {
  if (!isNodeOfType(programRoot, "Program")) return [];
  const exportAllSources: string[] = [];
  for (const statement of programRoot.body ?? []) {
    if (isNodeOfType(statement, "ExportNamedDeclaration") && statement.source) {
      const sourceValue = statement.source.value;
      if (typeof sourceValue !== "string") continue;
      for (const specifier of statement.specifiers ?? []) {
        if (!isNodeOfType(specifier, "ExportSpecifier")) continue;
        const exported = specifier.exported;
        const exportedNameSpec = isNodeOfType(exported, "Identifier")
          ? exported.name
          : isNodeOfType(exported, "Literal") && typeof exported.value === "string"
            ? exported.value
            : null;
        if (exportedNameSpec === exportedName) return [sourceValue];
      }
    }
    if (isNodeOfType(statement, "ExportAllDeclaration") && statement.source) {
      const sourceValue = statement.source.value;
      if (typeof sourceValue === "string") exportAllSources.push(sourceValue);
    }
  }
  return exportAllSources;
};
