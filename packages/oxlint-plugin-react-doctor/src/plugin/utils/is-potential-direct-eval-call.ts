import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isPotentialDirectEvalCall = (expression: EsTreeNode): boolean => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || call.arguments.length === 0) return false;
  // Downlevel TypeScript can turn optional bare eval into a direct call.
  const callee = stripParenExpression(call.callee);
  return isNodeOfType(callee, "Identifier") && callee.name === "eval";
};
