import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isLiteralVoidExpression = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  return (
    isNodeOfType(expression, "UnaryExpression") &&
    expression.operator === "void" &&
    isNodeOfType(stripParenExpression(expression.argument), "Literal")
  );
};
