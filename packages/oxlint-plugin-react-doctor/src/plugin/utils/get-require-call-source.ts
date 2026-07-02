import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Module source of a `require("x")` expression, unwrapping member access
// (`require("x").Y` / `require("x").Y.Z`) by recursing into the
// MemberExpression object. Null when the expression is not a require of a
// string literal.
export const getRequireCallSource = (expression: EsTreeNode): string | null => {
  if (isNodeOfType(expression, "MemberExpression")) {
    return getRequireCallSource(expression.object);
  }
  if (!isNodeOfType(expression, "CallExpression")) return null;
  if (!isNodeOfType(expression.callee, "Identifier") || expression.callee.name !== "require") {
    return null;
  }
  const [firstArgument] = expression.arguments ?? [];
  if (!firstArgument || !isNodeOfType(firstArgument, "Literal")) return null;
  return typeof firstArgument.value === "string" ? firstArgument.value : null;
};
