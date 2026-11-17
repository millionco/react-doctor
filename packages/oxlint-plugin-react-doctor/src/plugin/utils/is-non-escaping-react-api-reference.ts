import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isNonEscapingReactApiReference = (expression: EsTreeNode): boolean => {
  const referenceRoot = findTransparentExpressionRoot(expression);
  const parent = referenceRoot.parent;
  return (
    (isNodeOfType(parent, "CallExpression") && parent.callee === referenceRoot) ||
    (isNodeOfType(parent, "MemberExpression") && parent.object === referenceRoot) ||
    (isNodeOfType(parent, "Property") && parent.computed && parent.key === referenceRoot) ||
    (isNodeOfType(parent, "AssignmentPattern") && parent.right === referenceRoot)
  );
};
