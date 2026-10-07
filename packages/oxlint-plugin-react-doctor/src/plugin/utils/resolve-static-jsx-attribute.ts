import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface StaticJsxAttributeResolution {
  attribute: EsTreeNodeOfType<"JSXAttribute"> | null;
  expression: EsTreeNode | null;
  isPresent: boolean;
  isUnknown: boolean;
}

const MISSING_STATIC_JSX_ATTRIBUTE: StaticJsxAttributeResolution = {
  attribute: null,
  expression: null,
  isPresent: false,
  isUnknown: false,
};
const UNKNOWN_STATIC_JSX_ATTRIBUTE: StaticJsxAttributeResolution = {
  attribute: null,
  expression: null,
  isPresent: false,
  isUnknown: true,
};

const resolveObjectExpressionAttribute = (
  objectExpression: EsTreeNodeOfType<"ObjectExpression">,
  normalizedTargetName: string,
  isCaseSensitive: boolean,
): StaticJsxAttributeResolution => {
  for (
    let propertyIndex = objectExpression.properties.length - 1;
    propertyIndex >= 0;
    propertyIndex -= 1
  ) {
    const property = objectExpression.properties[propertyIndex];
    if (!property) return UNKNOWN_STATIC_JSX_ATTRIBUTE;
    if (isNodeOfType(property, "SpreadElement")) {
      if (!isNodeOfType(property.argument, "ObjectExpression")) {
        return UNKNOWN_STATIC_JSX_ATTRIBUTE;
      }
      const nestedResolution = resolveObjectExpressionAttribute(
        property.argument,
        normalizedTargetName,
        isCaseSensitive,
      );
      if (nestedResolution.isPresent || nestedResolution.isUnknown) return nestedResolution;
      continue;
    }
    if (!isNodeOfType(property, "Property")) return UNKNOWN_STATIC_JSX_ATTRIBUTE;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (!propertyName) return UNKNOWN_STATIC_JSX_ATTRIBUTE;
    const normalizedPropertyName = isCaseSensitive ? propertyName : propertyName.toLowerCase();
    if (normalizedPropertyName !== normalizedTargetName) continue;
    return {
      attribute: null,
      expression: property.value,
      isPresent: true,
      isUnknown: false,
    };
  }
  return MISSING_STATIC_JSX_ATTRIBUTE;
};

export const resolveStaticJsxAttribute = (
  attributes: ReadonlyArray<EsTreeNode>,
  targetName: string,
  isCaseSensitive = true,
): StaticJsxAttributeResolution => {
  const normalizedTargetName = isCaseSensitive ? targetName : targetName.toLowerCase();
  for (let attributeIndex = attributes.length - 1; attributeIndex >= 0; attributeIndex -= 1) {
    const attribute = attributes[attributeIndex];
    if (!attribute) return UNKNOWN_STATIC_JSX_ATTRIBUTE;
    if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
      if (!isNodeOfType(attribute.argument, "ObjectExpression")) {
        return UNKNOWN_STATIC_JSX_ATTRIBUTE;
      }
      const spreadResolution = resolveObjectExpressionAttribute(
        attribute.argument,
        normalizedTargetName,
        isCaseSensitive,
      );
      if (spreadResolution.isPresent || spreadResolution.isUnknown) return spreadResolution;
      continue;
    }
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const attributeName = getJsxAttributeName(attribute.name);
    const normalizedAttributeName = isCaseSensitive ? attributeName : attributeName?.toLowerCase();
    if (normalizedAttributeName !== normalizedTargetName) continue;
    return {
      attribute,
      expression: null,
      isPresent: true,
      isUnknown: false,
    };
  }
  return MISSING_STATIC_JSX_ATTRIBUTE;
};
