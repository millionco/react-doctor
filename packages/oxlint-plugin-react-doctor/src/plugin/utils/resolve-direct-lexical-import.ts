import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { ImportedApiReference } from "./resolve-imported-api-reference.js";
import { getImportedName } from "./get-imported-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStableLexicalBindingValue } from "./get-stable-lexical-binding-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// Only lexical ESM bindings or direct immutable identifier aliases. A property
// destructured from a default-exported object is never a named ESM binding.
export const resolveDirectLexicalImport = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): ImportedApiReference | null => {
  let node = stripParenExpression(expression);
  const visited = new Set<number>();
  while (isNodeOfType(node, "Identifier") && visited.size < 16) {
    const symbol = scopes.symbolFor(node);
    if (!symbol || visited.has(symbol.id)) return null;
    visited.add(symbol.id);
    if (symbol.kind === "import") {
      const declaration = getImportDeclarationForSymbol(symbol);
      const specifier = symbol.declarationNode;
      if (
        !declaration ||
        declaration.importKind === "type" ||
        typeof declaration.source.value !== "string" ||
        symbol.references.some((reference) => reference.flag !== "read")
      )
        return null;
      if (isNodeOfType(specifier, "ImportDefaultSpecifier"))
        return { source: declaration.source.value, importedName: "default", isNamespace: false };
      if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type")
        return null;
      const importedName = getImportedName(specifier);
      return importedName
        ? { source: declaration.source.value, importedName, isNamespace: false }
        : null;
    }
    const value = getStableLexicalBindingValue(symbol, scopes);
    if (!value || !isNodeOfType(value, "Identifier")) return null;
    node = value;
  }
  return null;
};
