import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const isDefinitelyFalsyExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "Literal")) return !unwrappedExpression.value;
  if (
    isNodeOfType(unwrappedExpression, "UnaryExpression") &&
    unwrappedExpression.operator === "void"
  ) {
    return true;
  }
  return (
    isNodeOfType(unwrappedExpression, "Identifier") &&
    unwrappedExpression.name === "undefined" &&
    scopes.isGlobalReference(unwrappedExpression)
  );
};
