import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isNumericResultExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "Literal")) return typeof candidate.value === "number";
  if (isNodeOfType(candidate, "UnaryExpression"))
    return candidate.operator === "+" || candidate.operator === "-" || candidate.operator === "~";
  if (isNodeOfType(candidate, "BinaryExpression"))
    return ["-", "*", "/", "%", "**", "<<", ">>", ">>>", "&", "|", "^"].includes(
      candidate.operator,
    );
  return false;
};
