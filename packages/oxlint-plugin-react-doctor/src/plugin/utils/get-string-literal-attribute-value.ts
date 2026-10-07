import type { EsTreeNode } from "./es-tree-node.js";
import { getJsxPropStringValue } from "./get-jsx-prop-string-value.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStringLiteralAttributeValue = (attribute: EsTreeNode): string | null => {
  if (!isNodeOfType(attribute, "JSXAttribute")) return null;
  const stringValue = getJsxPropStringValue(attribute);
  if (stringValue !== null) return stringValue;
  const value = attribute.value;
  if (value && isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return expression.value;
    }
    if (
      isNodeOfType(expression, "TemplateLiteral") &&
      expression.expressions.length === 0 &&
      expression.quasis.length === 1
    ) {
      return expression.quasis[0].value.cooked ?? expression.quasis[0].value.raw;
    }
  }
  return null;
};
