import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getPropertyKeyName = (property: EsTreeNode): string | null => {
  if (!isNodeOfType(property, "Property") && !isNodeOfType(property, "MethodDefinition"))
    return null;
  if (isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (isNodeOfType(property.key, "Literal")) return String(property.key.value);
  return null;
};
