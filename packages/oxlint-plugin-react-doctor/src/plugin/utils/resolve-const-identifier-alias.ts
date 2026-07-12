import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const resolveConstIdentifierAlias = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const visitedSymbolIds = new Set<number>();
  let symbol = scopes.symbolFor(identifier);
  while (symbol?.kind === "const") {
    if (
      visitedSymbolIds.has(symbol.id) ||
      !symbol.initializer ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return null;
    }
    visitedSymbolIds.add(symbol.id);
    const initializer = stripParenExpression(symbol.initializer);
    if (!isNodeOfType(initializer, "Identifier")) return symbol;
    symbol = scopes.symbolFor(initializer);
  }
  return symbol;
};
