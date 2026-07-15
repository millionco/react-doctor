import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

// Module source of a `require("x")` expression, unwrapping member access
// (`require("x").Y` / `require("x").Y.Z`) by recursing into the
// MemberExpression object. Null when the expression is not a require of a
// string literal.
export const getRequireCallSource = (expression: EsTreeNode): string | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    return getRequireCallSource(unwrappedExpression.object);
  }
  if (!isNodeOfType(unwrappedExpression, "CallExpression")) return null;
  if (
    !isNodeOfType(unwrappedExpression.callee, "Identifier") ||
    unwrappedExpression.callee.name !== "require"
  ) {
    return null;
  }
  const [firstArgument] = unwrappedExpression.arguments ?? [];
  if (!firstArgument || !isNodeOfType(firstArgument, "Literal")) return null;
  return typeof firstArgument.value === "string" ? firstArgument.value : null;
};
