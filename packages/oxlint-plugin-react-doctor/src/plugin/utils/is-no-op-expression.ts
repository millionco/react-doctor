import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";

export interface NoOpExpressionOptions {
  readonly isNoOpIdentifier?: (identifier: EsTreeNodeOfType<"Identifier">) => boolean;
}

export const isNoOpExpression = (
  node: EsTreeNode,
  options: NoOpExpressionOptions = {},
): boolean => {
  let expression = stripParenExpression(node);
  while (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void")
    expression = stripParenExpression(expression.argument);
  if (isNodeOfType(expression, "Literal")) return true;
  if (isNodeOfType(expression, "Identifier"))
    return options.isNoOpIdentifier
      ? options.isNoOpIdentifier(expression)
      : expression.name === "undefined";
  return false;
};
