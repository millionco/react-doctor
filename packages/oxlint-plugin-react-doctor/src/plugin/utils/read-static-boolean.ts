import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const readStaticBoolean = (node: EsTreeNode | null | undefined): boolean | null => {
  if (!node) return null;
  const unwrappedNode = stripParenExpression(node);
  if (!isNodeOfType(unwrappedNode, "Literal") || typeof unwrappedNode.value !== "boolean") {
    return null;
  }
  return unwrappedNode.value;
};
