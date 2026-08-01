import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticObjectPropertyValue } from "./get-static-object-property-value.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getPropertyDescriptorValue = (node: EsTreeNode): EsTreeNode | null | undefined => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  for (const property of expression.properties) {
    if (!isNodeOfType(property, "Property")) return null;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null || propertyName === "get" || propertyName === "set") return null;
  }
  return getStaticObjectPropertyValue(expression, "value");
};
