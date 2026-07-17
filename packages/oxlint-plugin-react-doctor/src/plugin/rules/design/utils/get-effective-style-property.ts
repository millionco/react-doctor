import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { getStylePropertyKey } from "./get-style-property-key.js";

export const getEffectiveStyleProperty = (
  properties: ReadonlyArray<EsTreeNode> | undefined,
  propertyName: string,
): EsTreeNodeOfType<"Property"> | null => {
  for (const property of [...(properties ?? [])].reverse()) {
    const currentPropertyName = getStylePropertyKey(property);
    if (!currentPropertyName) return null;
    if (currentPropertyName === propertyName && isNodeOfType(property, "Property")) return property;
  }
  return null;
};
