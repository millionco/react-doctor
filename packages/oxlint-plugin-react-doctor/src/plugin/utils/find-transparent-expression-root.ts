import type { EsTreeNode } from "./es-tree-node.js";
import { TRANSPARENT_EXPRESSION_WRAPPER_TYPES } from "./strip-paren-expression.js";

export const findTransparentExpressionRoot = (node: EsTreeNode): EsTreeNode => {
  let current = node;
  while (current.parent && TRANSPARENT_EXPRESSION_WRAPPER_TYPES.has(current.parent.type)) {
    current = current.parent;
  }
  return current;
};
