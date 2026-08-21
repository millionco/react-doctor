import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";

export const readStaticJsxBooleanAttribute = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): boolean | null => {
  if (!attribute.value) return true;
  if (
    !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
    isNodeOfType(attribute.value.expression, "JSXEmptyExpression")
  ) {
    return null;
  }
  return readStaticBoolean(attribute.value.expression);
};
