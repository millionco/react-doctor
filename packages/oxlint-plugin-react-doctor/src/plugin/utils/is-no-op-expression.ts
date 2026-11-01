import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const isNoOpExpression = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal")) return true;
  if (isNodeOfType(expression, "Identifier")) return true;
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
    return isNoOpExpression(expression.argument);
  }
  return false;
};
