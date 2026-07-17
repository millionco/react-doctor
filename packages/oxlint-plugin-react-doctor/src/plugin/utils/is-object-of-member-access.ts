import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isObjectOfMemberAccess = (node: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(node);
  const parent = expressionRoot.parent;
  return Boolean(
    parent && isNodeOfType(parent, "MemberExpression") && parent.object === expressionRoot,
  );
};
