import type { EsTreeNode } from "./es-tree-node.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFinalSequenceExpressionValue } from "./get-final-sequence-expression-value.js";
import { isNodeOfType } from "./is-node-of-type.js";

const isKnownDefinedExpression = (expression: EsTreeNode): boolean => {
  const value = getFinalSequenceExpressionValue(expression);
  if (isNodeOfType(value, "JSXElement") || isNodeOfType(value, "JSXFragment")) return true;
  if (isNodeOfType(value, "Literal")) {
    return (
      value.value === null ||
      typeof value.value === "string" ||
      typeof value.value === "number" ||
      typeof value.value === "boolean"
    );
  }
  if (isNodeOfType(value, "ConditionalExpression")) {
    return isKnownDefinedExpression(value.consequent) && isKnownDefinedExpression(value.alternate);
  }
  if (!isNodeOfType(value, "LogicalExpression")) return false;
  return (
    isKnownDefinedExpression(value.right) &&
    (value.operator !== "&&" || isKnownDefinedExpression(value.left))
  );
};

export const isPossiblyUndefinedFragmentReturn = (
  fragmentNode: EsTreeNode,
  expression: EsTreeNode,
): boolean => {
  if (isNodeOfType(expression, "JSXEmptyExpression")) return false;
  const returnValue = findTransparentExpressionRoot(fragmentNode);
  const parent = returnValue.parent;
  const isDirectReturn =
    (isNodeOfType(parent, "ReturnStatement") && parent.argument === returnValue) ||
    (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === returnValue);
  return isDirectReturn && !isKnownDefinedExpression(expression);
};
