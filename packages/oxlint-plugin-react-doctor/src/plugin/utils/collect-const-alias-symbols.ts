import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const collectConstAliasSymbols = (
  sourceSymbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  const symbols: SymbolDescriptor[] = [];
  const pendingSymbols = [sourceSymbol];
  const visitedSymbolIds = new Set<number>();
  while (pendingSymbols.length > 0) {
    const symbol = pendingSymbols.pop();
    if (!symbol || visitedSymbolIds.has(symbol.id)) continue;
    visitedSymbolIds.add(symbol.id);
    symbols.push(symbol);
    for (const reference of symbol.references) {
      const referenceRoot = findTransparentExpressionRoot(reference.identifier);
      const declarator = referenceRoot.parent;
      if (
        !isNodeOfType(declarator, "VariableDeclarator") ||
        declarator.init !== referenceRoot ||
        !isNodeOfType(declarator.id, "Identifier")
      ) {
        continue;
      }
      const aliasSymbol = scopes.symbolFor(declarator.id);
      if (aliasSymbol?.kind === "const") pendingSymbols.push(aliasSymbol);
    }
  }
  return symbols;
};
