import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getEffectiveObjectPropertiesInInsertionOrder } from "../../../utils/get-effective-object-properties-in-insertion-order.js";
import { getStylePropertyKey } from "./get-style-property-key.js";

export const getEffectiveStylePropertyAmong = (
  properties: ReadonlyArray<EsTreeNode> | undefined,
  propertyNames: ReadonlySet<string>,
): EsTreeNodeOfType<"Property"> | null => {
  const effectiveProperties = getEffectiveObjectPropertiesInInsertionOrder(properties);
  if (!effectiveProperties) return null;
  for (const property of effectiveProperties.reverse()) {
    const currentPropertyName = getStylePropertyKey(property);
    if (!currentPropertyName || !propertyNames.has(currentPropertyName)) continue;
    return property;
  }
  return null;
};
