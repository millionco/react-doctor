import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPrimitiveLiteral } from "./is-primitive-literal.js";
import { stripParenExpression } from "./strip-paren-expression.js";

interface StaticObjectPropertyOptions {
  followLiteralSpreads?: boolean;
  isSpreadKnownToOmitProperty?: (expression: EsTreeNode) => boolean;
}

export const getStaticObjectProperty = (
  node: EsTreeNode,
  expectedPropertyName: string,
  options: StaticObjectPropertyOptions = {},
): EsTreeNodeOfType<"Property"> | null | undefined => {
  const expression = stripParenExpression(node);
  if (!isNodeOfType(expression, "ObjectExpression")) {
    return options.isSpreadKnownToOmitProperty?.(expression) ? undefined : null;
  }
  if (
    options.followLiteralSpreads &&
    expression.properties.some(
      (property) => isNodeOfType(property, "Property") && property.kind === "get",
    )
  ) {
    return null;
  }
  for (
    let propertyIndex = expression.properties.length - 1;
    propertyIndex >= 0;
    propertyIndex -= 1
  ) {
    const property = expression.properties[propertyIndex];
    if (options.followLiteralSpreads && isNodeOfType(property, "SpreadElement")) {
      const effectiveProperty = getStaticObjectProperty(
        property.argument,
        expectedPropertyName,
        options,
      );
      if (effectiveProperty !== undefined) return effectiveProperty;
      continue;
    }
    if (!isNodeOfType(property, "Property")) return null;
    const propertyName = getStaticPropertyKeyName(property, {
      allowComputedString: true,
      stringifyNonStringLiterals:
        options.followLiteralSpreads === true && isPrimitiveLiteral(property.key),
    });
    if (propertyName === null) return null;
    if (propertyName === expectedPropertyName) return property;
  }
  return undefined;
};
