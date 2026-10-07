import { BOOLEAN_COMPARISON_OPERATORS } from "../constants/boolean-comparison-operators.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isBooleanResultExpression = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const expression = stripParenExpression(node);
  return (
    (isNodeOfType(expression, "Literal") && typeof expression.value === "boolean") ||
    (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") ||
    (isNodeOfType(expression, "BinaryExpression") &&
      BOOLEAN_COMPARISON_OPERATORS.has(expression.operator))
  );
};
