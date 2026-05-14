import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getCalleeName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "CallExpression") && !isNodeOfType(node, "NewExpression")) return null;
  if (isNodeOfType(node.callee, "Identifier")) return node.callee.name;
  if (
    isNodeOfType(node.callee, "MemberExpression") &&
    isNodeOfType(node.callee.property, "Identifier")
  ) {
    return node.callee.property.name;
  }
  return null;
};
