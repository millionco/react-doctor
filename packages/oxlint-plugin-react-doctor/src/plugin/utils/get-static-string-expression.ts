import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticStringExpression = (
  expression: EsTreeNode | null | undefined,
): string | null => {
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return expression.value;
  }
  if (isNodeOfType(expression, "TemplateLiteral") && expression.expressions.length === 0) {
    return expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw ?? null;
  }
  return null;
};
