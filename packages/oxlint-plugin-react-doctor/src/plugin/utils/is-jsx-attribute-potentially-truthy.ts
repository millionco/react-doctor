import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isLiteralVoidExpression } from "./is-literal-void-expression.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isJsxAttributePotentiallyTruthy = (
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null | undefined,
): boolean => {
  if (!attribute) return false;
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) {
    return attribute.value.value !== false && attribute.value.value !== null;
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  if (isLiteralVoidExpression(expression)) return false;
  return (
    !isNodeOfType(expression, "Literal") ||
    (expression.value !== false && expression.value !== null)
  );
};
