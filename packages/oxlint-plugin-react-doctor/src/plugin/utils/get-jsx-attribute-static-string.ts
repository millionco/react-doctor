import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getJsxAttributeStaticString = (attribute: EsTreeNode): string | null => {
  if (!isNodeOfType(attribute, "JSXAttribute") || !attribute.value) return null;
  if (isNodeOfType(attribute.value, "Literal") && typeof attribute.value.value === "string") {
    return attribute.value.value;
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return null;
  const expression = attribute.value.expression;
  if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
    return expression.value;
  }
  if (
    isNodeOfType(expression, "TemplateLiteral") &&
    expression.expressions.length === 0 &&
    expression.quasis.length === 1
  ) {
    return expression.quasis[0].value.raw;
  }
  return null;
};
