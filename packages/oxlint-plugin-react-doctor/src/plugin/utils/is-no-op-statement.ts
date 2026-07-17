import { isNodeOfType } from "./is-node-of-type.js";
import { isLiteralVoidExpression } from "./is-literal-void-expression.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type { EsTreeNode } from "./es-tree-node.js";

// `void 0;`, a bare literal (including "use client"-style directives), and
// `;` execute nothing observable. Rules whose contract is "the body
// contains ONLY setState calls" must skip these instead of letting a no-op
// statement silence detection.
export const isNoOpStatement = (statement: EsTreeNode): boolean => {
  if (isNodeOfType(statement, "EmptyStatement")) return true;
  if (!isNodeOfType(statement, "ExpressionStatement")) return false;
  const expression = stripParenExpression(statement.expression);
  if (isNodeOfType(expression, "Literal")) return true;
  if (isNodeOfType(expression, "Identifier")) return expression.name === "undefined";
  return isLiteralVoidExpression(expression);
};
