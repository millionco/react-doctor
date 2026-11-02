import type {
  ScopeAnalysis,
  ScopeDescriptor,
  SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingIdentifier } from "./get-function-binding-name.js";

export const getFunctionBindingSymbols = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
  bindingSymbolsByScope?: WeakMap<ScopeDescriptor, WeakMap<EsTreeNode, SymbolDescriptor[]>>,
): SymbolDescriptor[] => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return [];
  let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(functionNode);
  while (scope) {
    let symbolsByBindingIdentifier = bindingSymbolsByScope?.get(scope);
    if (bindingSymbolsByScope && !symbolsByBindingIdentifier) {
      symbolsByBindingIdentifier = new WeakMap();
      for (const symbol of scope.symbols) {
        const matchingSymbols = symbolsByBindingIdentifier.get(symbol.bindingIdentifier);
        if (matchingSymbols) matchingSymbols.push(symbol);
        else symbolsByBindingIdentifier.set(symbol.bindingIdentifier, [symbol]);
      }
      bindingSymbolsByScope.set(scope, symbolsByBindingIdentifier);
    }
    const symbols = symbolsByBindingIdentifier
      ? (symbolsByBindingIdentifier.get(bindingIdentifier)?.slice() ?? [])
      : scope.symbols.filter((symbol) => symbol.bindingIdentifier === bindingIdentifier);
    if (symbols.length > 0) return symbols;
    scope = scope.parent;
  }
  return [];
};
