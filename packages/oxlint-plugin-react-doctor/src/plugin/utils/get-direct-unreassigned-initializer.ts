import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getDirectUnreassignedInitializer = (symbol: SymbolDescriptor): EsTreeNode | null => {
  const constInitializer = getDirectConstInitializer(symbol);
  if (constInitializer) return constInitializer;
  if (
    (symbol.kind !== "let" && symbol.kind !== "var") ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier ||
    !symbol.references.every((reference) => reference.flag === "read") ||
    symbol.scope.symbols.some(
      (siblingSymbol) => siblingSymbol !== symbol && siblingSymbol.name === symbol.name,
    )
  ) {
    return null;
  }
  return symbol.initializer;
};
