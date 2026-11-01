import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const isConstructivelyStringExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  return (
    (isNodeOfType(candidate, "Literal") && typeof candidate.value === "string") ||
    isNodeOfType(candidate, "TemplateLiteral") ||
    (isNodeOfType(candidate, "BinaryExpression") &&
      candidate.operator === "+" &&
      (isConstructivelyStringExpression(candidate.left) ||
        isConstructivelyStringExpression(candidate.right)))
  );
};
