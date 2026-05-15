import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getStylePropertyNumberValue = (property: EsTreeNode): number | null => {
  if (!isNodeOfType(property, "Property")) return null;
  if (isNodeOfType(property.value, "Literal") && typeof property.value.value === "number") {
    return property.value.value;
  }
  if (
    isNodeOfType(property.value, "UnaryExpression") &&
    property.value.operator === "-" &&
    isNodeOfType(property.value.argument, "Literal") &&
    typeof property.value.argument.value === "number"
  ) {
    return -property.value.argument.value;
  }
  return null;
};
