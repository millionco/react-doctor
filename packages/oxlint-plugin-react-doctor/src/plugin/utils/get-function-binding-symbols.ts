import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getFunctionBindingIdentifier } from "./get-function-binding-name.js";

export const getFunctionBindingSymbols = (
  functionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor[] => {
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return [];
  let scope: ScopeAnalysis["rootScope"] | null = scopes.scopeFor(functionNode);
  while (scope) {
    const symbols = scope.symbols.filter(
      (symbol) => symbol.bindingIdentifier === bindingIdentifier,
    );
    if (symbols.length > 0) return symbols;
    scope = scope.parent;
  }
  return [];
};
