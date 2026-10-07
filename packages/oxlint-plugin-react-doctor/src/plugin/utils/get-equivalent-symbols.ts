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

const buildEquivalentSymbolsByRootId = (scopes: ScopeAnalysis): Map<number, SymbolDescriptor[]> => {
  const symbolsByRootId = new Map<number, SymbolDescriptor[]>();
  const allSymbols: SymbolDescriptor[] = [];
  collectScopeSymbols(scopes.rootScope, allSymbols);
  for (const symbol of allSymbols) {
    const rootSymbol = resolveConstIdentifierAlias(symbol.bindingIdentifier, scopes);
    if (!rootSymbol) continue;
    const equivalentSymbols = symbolsByRootId.get(rootSymbol.id) ?? [];
    equivalentSymbols.push(symbol);
    symbolsByRootId.set(rootSymbol.id, equivalentSymbols);
  }
  return symbolsByRootId;
};

export const getEquivalentSymbols = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  const rootSymbol = resolveConstIdentifierAlias(identifier, scopes);
  if (!rootSymbol) return [];
  let symbolsByRootId = equivalentSymbolsByAnalysis.get(scopes);
  if (!symbolsByRootId) {
    symbolsByRootId = buildEquivalentSymbolsByRootId(scopes);
    equivalentSymbolsByAnalysis.set(scopes, symbolsByRootId);
  }
  return symbolsByRootId.get(rootSymbol.id) ?? [];
};
