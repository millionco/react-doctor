import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const traceConstValue = (node: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode => {
  const visited = new Set<number>();
  let current = node;
  while (isNodeOfType(current, "Identifier") || isNodeOfType(current, "JSXIdentifier")) {
    const symbol = scopes.symbolFor(current);
    if (!symbol || symbol.kind !== "const" || !symbol.initializer) return current;
    if (visited.has(symbol.id)) return current;
    visited.add(symbol.id);
    current = symbol.initializer;
  }
  return current;
};
