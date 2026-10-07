import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getEffectiveObjectPropertiesInInsertionOrder = (
  properties: ReadonlyArray<EsTreeNode> | undefined,
): EsTreeNodeOfType<"Property">[] | null => {
  const latestPropertyByName = new Map<string, EsTreeNodeOfType<"Property">>();
  const collectProperties = (candidateProperties: ReadonlyArray<EsTreeNode>): boolean => {
    for (const property of candidateProperties) {
      if (isNodeOfType(property, "SpreadElement")) {
        if (
          !isNodeOfType(property.argument, "ObjectExpression") ||
          !collectProperties(property.argument.properties)
        ) {
          return false;
        }
        continue;
      }
      const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
      if (!propertyName || !isNodeOfType(property, "Property")) return false;
      latestPropertyByName.set(propertyName, property);
    }
    return true;
  };
  if (!collectProperties(properties ?? [])) return null;
  return [...latestPropertyByName.values()];
};
