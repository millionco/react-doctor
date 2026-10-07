import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticRouteProperty = (
  routeObject: EsTreeNodeOfType<"ObjectExpression">,
  propertyName: string,
): EsTreeNodeOfType<"Property"> | null => {
  for (const property of routeObject.properties ?? []) {
    if (!isNodeOfType(property, "Property")) continue;
    if (getStaticPropertyKeyName(property, { allowComputedString: true }) === propertyName) {
      return property;
    }
  }
  return null;
};
