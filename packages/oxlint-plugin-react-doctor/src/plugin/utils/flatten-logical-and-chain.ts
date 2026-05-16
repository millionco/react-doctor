import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const flattenLogicalAndChain = (node: EsTreeNode): EsTreeNode[] => {
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "&&") {
    return [...flattenLogicalAndChain(node.left), ...flattenLogicalAndChain(node.right)];
  }
  return [node];
};
