import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// The single expression a one-liner callback evaluates to: an arrow's
// expression body, or the argument of the lone `return` in a one-statement
// block body. Null when the body carries more than one statement — the
// predicate is then too complex to reason about structurally.
export const singleExpressionPredicateBody = (
  predicate: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
): EsTreeNode | null => {
  let body: EsTreeNode = predicate.body;
  if (isNodeOfType(body, "BlockStatement")) {
    if (body.body.length !== 1) return null;
    const onlyStatement = body.body[0];
    if (!isNodeOfType(onlyStatement, "ReturnStatement") || !onlyStatement.argument) return null;
    body = onlyStatement.argument;
  }
  return stripParenExpression(body);
};
