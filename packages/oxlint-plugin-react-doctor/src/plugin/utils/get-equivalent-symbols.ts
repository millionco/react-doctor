import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";

const equivalentSymbolsByAnalysis = new WeakMap<
  ScopeAnalysis,
  Map<boolean, Map<number, SymbolDescriptor[]>>
>();

const collectScopeSymbols = (scope: ScopeDescriptor, symbols: SymbolDescriptor[]): void => {
  symbols.push(...scope.symbols);
  for (const childScope of scope.children) collectScopeSymbols(childScope, symbols);
};

const buildEquivalentSymbolsByRootId = (
  scopes: ScopeAnalysis,
  allowPatternBinding: boolean,
): Map<number, SymbolDescriptor[]> => {
  const symbolsByRootId = new Map<number, SymbolDescriptor[]>();
  const allSymbols: SymbolDescriptor[] = [];
  collectScopeSymbols(scopes.rootScope, allSymbols);
  for (const symbol of allSymbols) {
    const rootSymbol = resolveConstIdentifierAlias(
      symbol.bindingIdentifier,
      scopes,
      allowPatternBinding,
    );
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
  allowPatternBinding = false,
): SymbolDescriptor[] => {
  const rootSymbol = resolveConstIdentifierAlias(identifier, scopes, allowPatternBinding);
  if (!rootSymbol) return [];
  let symbolsByPatternBinding = equivalentSymbolsByAnalysis.get(scopes);
  if (!symbolsByPatternBinding) {
    symbolsByPatternBinding = new Map();
    equivalentSymbolsByAnalysis.set(scopes, symbolsByPatternBinding);
  }
  let symbolsByRootId = symbolsByPatternBinding.get(allowPatternBinding);
  if (!symbolsByRootId) {
    symbolsByRootId = buildEquivalentSymbolsByRootId(scopes, allowPatternBinding);
    symbolsByPatternBinding.set(allowPatternBinding, symbolsByRootId);
  }
  return symbolsByRootId.get(rootSymbol.id) ?? [];
};
