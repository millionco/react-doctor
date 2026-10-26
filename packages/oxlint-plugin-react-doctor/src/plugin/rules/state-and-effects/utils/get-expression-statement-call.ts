import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const getExpressionStatementCall = (
  statement: EsTreeNode | undefined,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  return isNodeOfType(expression, "CallExpression") && !expression.optional ? expression : null;
};
