import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const findCallbackSelectionRoot = (expression: EsTreeNode): EsTreeNode => {
  let callbackValue = findTransparentExpressionRoot(expression);
  while (callbackValue.parent) {
    const parent = callbackValue.parent;
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        parent.test !== callbackValue &&
        (parent.consequent === callbackValue || parent.alternate === callbackValue)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.right === callbackValue ||
          (parent.left === callbackValue && parent.operator !== "&&"))) ||
      (isNodeOfType(parent, "SequenceExpression") && parent.expressions.at(-1) === callbackValue)
    ) {
      callbackValue = findTransparentExpressionRoot(parent);
      continue;
    }
    break;
  }
  return callbackValue;
};
