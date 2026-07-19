import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const findVisibleSymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const referenceSymbol = scopes.symbolFor(identifier);
  if (referenceSymbol) return referenceSymbol;
  if (!isNodeOfType(identifier, "Identifier")) return null;
  let scope = scopes.scopeFor(identifier);
  while (true) {
    const symbol = scope.symbolsByName.get(identifier.name);
    if (symbol) return symbol;
    if (!scope.parent) return null;
    scope = scope.parent;
  }
};
