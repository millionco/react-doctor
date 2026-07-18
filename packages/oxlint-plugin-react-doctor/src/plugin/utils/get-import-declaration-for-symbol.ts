import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getImportDeclarationForSymbol = (
  symbol: SymbolDescriptor,
): EsTreeNodeOfType<"ImportDeclaration"> | null => {
  if (symbol.kind !== "import") return null;
  const importDeclaration = symbol.declarationNode.parent;
  return isNodeOfType(importDeclaration, "ImportDeclaration") ? importDeclaration : null;
};
