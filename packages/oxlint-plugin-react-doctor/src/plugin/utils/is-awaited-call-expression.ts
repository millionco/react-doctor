import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isAwaitedCallExpression = (node: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(node);
  return Boolean(
    expressionRoot.parent &&
    isNodeOfType(expressionRoot.parent, "AwaitExpression") &&
    expressionRoot.parent.argument === expressionRoot,
  );
};
