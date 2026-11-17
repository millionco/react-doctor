import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface FindVisibleSymbolOptions {
  readonly name: string;
  readonly accept?: (symbol: SymbolDescriptor) => boolean;
}

export const findVisibleSymbol = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  options?: FindVisibleSymbolOptions,
): SymbolDescriptor | null => {
  const referenceSymbol = options ? null : scopes.symbolFor(identifier);
  if (referenceSymbol) return referenceSymbol;
  const name = options?.name ?? (isNodeOfType(identifier, "Identifier") ? identifier.name : null);
  if (!name) return null;
  const accept = options?.accept;
  let scope = scopes.scopeFor(identifier);
  while (true) {
    let symbol = scope.symbolsByName.get(name);
    if (accept && symbol && !accept(symbol)) {
      symbol = scope.symbols.findLast((candidate) => candidate.name === name && accept(candidate));
    }
    if (symbol) return symbol;
    if (!scope.parent) return null;
    scope = scope.parent;
  }
};
