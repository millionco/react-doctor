import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { collectComponentScopeReferenceNames } from "./collect-component-scope-reference-names.js";

export const collectRenderReachableNames = (
  renderReachableExpressions: EsTreeNode[],
  eventHandlerReferenceNames: Set<string> = new Set(),
): Set<string> => {
  const names = new Set<string>();
  for (const expression of renderReachableExpressions) {
    for (const name of collectComponentScopeReferenceNames(
      expression,
      eventHandlerReferenceNames,
    )) {
      names.add(name);
    }
  }
  return names;
};
