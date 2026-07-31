import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const resolveConstIdentifierAlias = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  allowPatternBinding = false,
): SymbolDescriptor | null => {
  if (identifier.type !== "Identifier" && identifier.type !== "JSXIdentifier") {
    return null;
  }
  let visitedSymbolIds: Set<number> | null = null;
  let symbol = scopes.symbolFor(identifier);
  while (symbol?.kind === "const") {
    if (!symbol.initializer || symbol.declarationNode.type !== "VariableDeclarator") {
      return null;
    }
    if (symbol.declarationNode.id !== symbol.bindingIdentifier) {
      return allowPatternBinding ? symbol : null;
    }
    const initializer = stripParenExpression(symbol.initializer);
    if (initializer.type !== "Identifier") return symbol;
    if (visitedSymbolIds?.has(symbol.id)) return null;
    if (!visitedSymbolIds) visitedSymbolIds = new Set();
    visitedSymbolIds.add(symbol.id);
    symbol = scopes.symbolFor(initializer);
  }
  return symbol;
};
