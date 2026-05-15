import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getEffectCallback = (node: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) return null;
  if (!node.arguments?.length) return null;
  const callback = node.arguments[0];
  if (
    isNodeOfType(callback, "ArrowFunctionExpression") ||
    isNodeOfType(callback, "FunctionExpression")
  ) {
    return callback;
  }
  return null;
};
