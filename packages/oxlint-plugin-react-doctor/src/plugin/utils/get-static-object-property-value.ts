import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const getStaticObjectPropertyValue = (
  node: EsTreeNode,
  expectedPropertyName: string,
): EsTreeNode | null | undefined => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ObjectExpression")) return null;
  let propertyValue: EsTreeNode | null | undefined;
  for (const property of expression.properties) {
    if (!isNodeOfType(property, "Property")) {
      propertyValue = null;
      continue;
    }
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName === null) {
      propertyValue = null;
      continue;
    }
    if (propertyName !== expectedPropertyName) continue;
    propertyValue = property.kind === "init" ? property.value : null;
  }
  return propertyValue;
};
