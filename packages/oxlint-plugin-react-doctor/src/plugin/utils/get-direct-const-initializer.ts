import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getDirectConstInitializer = (symbol: SymbolDescriptor): EsTreeNode | null => {
  if (
    symbol.kind !== "const" ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  return symbol.initializer;
};
