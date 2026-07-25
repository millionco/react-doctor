import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const collectAuthoritativeStaticObjectPropertyNames = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
): ReadonlySet<string> | null => {
  const propertyNames = new Set<string>();
  for (
    let propertyIndex = objectExpression.properties.length - 1;
    propertyIndex >= 0;
    propertyIndex -= 1
  ) {
    const property = objectExpression.properties[propertyIndex];
    if (!property || isNodeOfType(property, "SpreadElement")) return null;
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) return null;
    propertyNames.add(propertyName);
  }
  return propertyNames;
};
