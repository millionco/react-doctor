import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

export const resolveStyleSheetCreateCallExpression = (
  expression: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!expression) return null;
  const callExpression = stripParenExpression(expression);
  if (!isNodeOfType(callExpression, "CallExpression")) return null;
  const callee = callExpression.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    !isNodeOfType(callee.object, "Identifier") ||
    callee.object.name !== "StyleSheet" ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "create"
  ) {
    return null;
  }
  return callExpression;
};
