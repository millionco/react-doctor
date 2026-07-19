import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getFinalSequenceExpressionValue = (expression: EsTreeNode): EsTreeNode => {
  let finalExpression = stripParenExpression(expression);
  while (isNodeOfType(finalExpression, "SequenceExpression")) {
    const sequenceResult = finalExpression.expressions.at(-1);
    if (!sequenceResult) break;
    finalExpression = stripParenExpression(sequenceResult);
  }
  return finalExpression;
};
