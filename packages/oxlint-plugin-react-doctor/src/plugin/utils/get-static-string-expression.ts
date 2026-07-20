import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getStaticStringExpression = (
  expression: EsTreeNode | null | undefined,
): string | null => {
  if (!expression) return null;
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "Literal") &&
    typeof unwrappedExpression.value === "string"
  ) {
    return unwrappedExpression.value;
  }
  if (
    isNodeOfType(unwrappedExpression, "TemplateLiteral") &&
    unwrappedExpression.expressions.length === 0
  ) {
    return (
      unwrappedExpression.quasis[0]?.value.cooked ??
      unwrappedExpression.quasis[0]?.value.raw ??
      null
    );
  }
  return null;
};
