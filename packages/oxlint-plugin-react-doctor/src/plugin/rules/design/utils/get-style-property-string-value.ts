import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getStylePropertyStringValue = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property")) return null;
  if (isNodeOfType(property.value, "Literal") && typeof property.value.value === "string") {
    return property.value.value;
  }
  return null;
};
