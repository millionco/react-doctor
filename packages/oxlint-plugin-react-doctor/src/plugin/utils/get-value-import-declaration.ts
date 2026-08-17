import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";

// The `ImportDeclaration` behind a symbol when (and only when) the binding
// carries a runtime value: import symbols whose declaration is neither a
// type-only declaration nor an inline `type` specifier. Returns null for
// local bindings and type-only imports.
export const getValueImportDeclaration = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (symbol.kind !== "import") return null;
  const declaration = symbol.declarationNode.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "ImportDeclaration") ||
    isTypeOnlyImport(declaration) ||
    (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      symbol.declarationNode.importKind === "type")
  ) {
    return null;
  }
  return declaration;
};

export const getValueImportSource = (symbol: SymbolDescriptor): string | null => {
  const declaration = getValueImportDeclaration(symbol);
  if (!declaration || !isNodeOfType(declaration, "ImportDeclaration")) return null;
  const source = declaration.source.value;
  return typeof source === "string" ? source : null;
};
