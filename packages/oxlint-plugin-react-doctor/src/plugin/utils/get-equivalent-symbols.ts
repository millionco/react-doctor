import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";

const equivalentSymbolsByAnalysis = new WeakMap<ScopeAnalysis, Map<number, SymbolDescriptor[]>>();

const collectScopeSymbols = (scope: ScopeDescriptor, symbols: SymbolDescriptor[]): void => {
  symbols.push(...scope.symbols);
  for (const childScope of scope.children) collectScopeSymbols(childScope, symbols);
};

export const getEquivalentSymbols = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  const rootSymbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!rootSymbol) return [];
  let symbolsByRootId = equivalentSymbolsByAnalysis.get(scopes);
  if (!symbolsByRootId) {
    symbolsByRootId = new Map();
    equivalentSymbolsByAnalysis.set(scopes, symbolsByRootId);
  }
  const cachedSymbols = symbolsByRootId.get(rootSymbol.id);
  if (cachedSymbols) return cachedSymbols;
  const allSymbols: SymbolDescriptor[] = [];
  collectScopeSymbols(scopes.rootScope, allSymbols);
  const equivalentSymbols = allSymbols.filter(
    (symbol) => resolveConstIdentifierAlias(symbol.bindingIdentifier, scopes)?.id === rootSymbol.id,
  );
  symbolsByRootId.set(rootSymbol.id, equivalentSymbols);
  return equivalentSymbols;
};
