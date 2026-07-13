import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const hasVisibleBindingNamed = (
  node: EsTreeNode,
  bindingName: string,
  scopes: ScopeAnalysis,
): boolean => {
  let scope = scopes.scopeFor(node);
  while (true) {
    if (scope.symbolsByName.has(bindingName)) return true;
    if (!scope.parent) return false;
    scope = scope.parent;
  }
};
