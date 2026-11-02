import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const hasNonWhitespaceStringAffix = (expression: EsTreeNode): boolean => {
  const pendingExpressions = [expression];
  while (pendingExpressions.length > 0) {
    const currentExpression = pendingExpressions.pop();
    if (!currentExpression) continue;
    const unwrappedExpression = stripParenExpression(currentExpression);
    if (isNodeOfType(unwrappedExpression, "TemplateLiteral")) {
      if (
        unwrappedExpression.quasis.some(
          (templatePart) => (templatePart.value.cooked?.trim().length ?? 0) > 0,
        )
      ) {
        return true;
      }
      continue;
    }
    const staticString = getStaticStringExpression(unwrappedExpression);
    if (staticString !== null && staticString.trim().length > 0) return true;
    if (
      isNodeOfType(unwrappedExpression, "BinaryExpression") &&
      unwrappedExpression.operator === "+"
    ) {
      pendingExpressions.push(unwrappedExpression.left, unwrappedExpression.right);
    }
  }
  return false;
};
