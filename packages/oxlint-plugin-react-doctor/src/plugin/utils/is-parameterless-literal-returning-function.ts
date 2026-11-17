import type { EsTreeNode } from "./es-tree-node.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isParameterlessLiteralReturningFunction = (expression: EsTreeNode): boolean => {
  const functionNode = stripParenExpression(expression);
  if (!isFunctionLike(functionNode) || functionNode.params.length !== 0) return false;
  const returnedExpression = getSingleReturnExpression(functionNode);
  return Boolean(
    returnedExpression && isNodeOfType(stripParenExpression(returnedExpression), "Literal"),
  );
};
