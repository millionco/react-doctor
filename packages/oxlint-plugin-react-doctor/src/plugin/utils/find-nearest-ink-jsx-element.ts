import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveInkJsxElementName } from "./resolve-ink-api-name.js";

export const findNearestInkJsxElement = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  let ancestorNode = node.parent;
  while (ancestorNode) {
    if (isNodeOfType(ancestorNode, "JSXElement")) {
      const inkElementName = resolveInkJsxElementName(ancestorNode.openingElement, scopes);
      if (inkElementName) return inkElementName;
    }
    ancestorNode = ancestorNode.parent;
  }
  return null;
};
