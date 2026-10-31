import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getBooleanCallArgument = (node: EsTreeNode): EsTreeNode | null => {
  const expression = stripParenExpression(node);
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== 1
  ) {
    return null;
  }
  const callee = stripParenExpression(expression.callee);
  if (
    !(isNodeOfType(callee, "Identifier") && callee.name === "Boolean") &&
    !(isNodeOfType(callee, "MemberExpression") && getStaticPropertyName(callee) === "Boolean")
  ) {
    return null;
  }
  const argument = expression.arguments[0];
  return argument && !isNodeOfType(argument, "SpreadElement")
    ? stripParenExpression(argument)
    : null;
};
