import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const unwrapDiscardedExpression = (node: EsTreeNode): EsTreeNode => {
  let expression: EsTreeNode = isNodeOfType(node, "ExpressionStatement") ? node.expression : node;
  for (;;) {
    expression = stripParenExpression(expression);
    if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "void") {
      expression = expression.argument;
      continue;
    }
    if (isNodeOfType(expression, "SequenceExpression")) {
      const expressions = expression.expressions ?? [];
      const finalExpression = expressions.at(-1);
      const prefixExpressions = expressions.slice(0, -1);
      if (
        finalExpression &&
        prefixExpressions.length > 0 &&
        prefixExpressions.every((prefixExpression) =>
          isNodeOfType(stripParenExpression(prefixExpression), "Literal"),
        )
      ) {
        expression = finalExpression;
        continue;
      }
    }
    return expression;
  }
};
