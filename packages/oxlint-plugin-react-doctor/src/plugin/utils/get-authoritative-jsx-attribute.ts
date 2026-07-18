import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

const canObjectExpressionOverrideAttribute = (
  expression: EsTreeNode,
  normalizedTargetName: string,
  isCaseSensitive: boolean,
): boolean => {
  if (!isNodeOfType(expression, "ObjectExpression")) return true;
  for (const property of expression.properties) {
    if (isNodeOfType(property, "SpreadElement")) {
      if (
        canObjectExpressionOverrideAttribute(
          property.argument,
          normalizedTargetName,
          isCaseSensitive,
        )
      ) {
        return true;
      }
      continue;
    }
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) return true;
    const normalizedPropertyName = isCaseSensitive ? propertyName : propertyName.toLowerCase();
    if (normalizedPropertyName === normalizedTargetName) return true;
  }
  return false;
};

export const getAuthoritativeJsxAttribute = (
  attributes: ReadonlyArray<EsTreeNode>,
  targetName: string,
  isCaseSensitive = true,
): EsTreeNodeOfType<"JSXAttribute"> | null => {
  const normalizedTargetName = isCaseSensitive ? targetName : targetName.toLowerCase();
  for (let attributeIndex = attributes.length - 1; attributeIndex >= 0; attributeIndex -= 1) {
    const attribute = attributes[attributeIndex];
    if (!attribute) return null;
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      if (
        canObjectExpressionOverrideAttribute(
          attribute.argument,
          normalizedTargetName,
          isCaseSensitive,
        )
      ) {
        return null;
      }
      continue;
    }
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    const normalizedAttributeName = isCaseSensitive ? attributeName : attributeName?.toLowerCase();
    if (normalizedAttributeName === normalizedTargetName) return attribute;
  }
  return null;
};
