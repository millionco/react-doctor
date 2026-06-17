import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxPropStringValue } from "./get-jsx-prop-string-value.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Resolve an attribute to its string value from a plain literal (`x="y"`) or a
// string literal inside an expression container (`x={'y'}`). Returns null for a
// dynamic value (`x={y}`) or boolean shorthand. Use this (not
// `getJsxPropStringValue` directly) when a brace-wrapped literal is statically
// known and should be judged, not silently skipped.
export const getStringLiteralAttributeValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): string | null => {
  const stringValue = getJsxPropStringValue(attribute);
  if (stringValue !== null) return stringValue;
  const value = attribute.value as EsTreeNode | null;
  if (value && isNodeOfType(value, "JSXExpressionContainer")) {
    const expression = value.expression;
    if (isNodeOfType(expression, "Literal") && typeof expression.value === "string") {
      return expression.value;
    }
  }
  return null;
};
