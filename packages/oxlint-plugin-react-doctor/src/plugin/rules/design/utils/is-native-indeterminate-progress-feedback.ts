import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const isNativeIndeterminateProgressFeedback = (
  openingElements: ReadonlyArray<EsTreeNodeOfType<"JSXOpeningElement">>,
): boolean => {
  const [progressOpeningElement] = openingElements;
  if (
    !progressOpeningElement ||
    !isNodeOfType(progressOpeningElement.name, "JSXIdentifier") ||
    progressOpeningElement.name.name !== "progress"
  ) {
    return false;
  }

  let hasLiteralLabel = false;
  for (const openingElement of openingElements) {
    if (
      !isNodeOfType(openingElement.name, "JSXIdentifier") ||
      openingElement.name.name === "svg" ||
      openingElement.name.name === "math" ||
      !HTML_TAGS.has(openingElement.name.name)
    ) {
      return false;
    }

    const attributeNames = new Set<string>();
    for (const attribute of openingElement.attributes) {
      if (
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier")
      ) {
        return false;
      }
      const attributeName = getJsxAttributeName(attribute.name);
      if (!attributeName) return false;
      const normalizedAttributeName = attributeName.toLowerCase();
      if (
        attributeNames.has(normalizedAttributeName) ||
        normalizedAttributeName.startsWith("xmlns")
      ) {
        return false;
      }
      attributeNames.add(normalizedAttributeName);
      switch (normalizedAttributeName) {
        case "role":
        case "hidden":
        case "aria-hidden":
        case "inert":
        case "is":
          return false;
      }
      if (openingElement !== progressOpeningElement) continue;
      const attributeValue = attribute.value;
      if (normalizedAttributeName === "value") {
        if (
          attributeName !== "value" ||
          !attributeValue ||
          !isNodeOfType(attributeValue, "JSXExpressionContainer") ||
          !isNodeOfType(attributeValue.expression, "Literal") ||
          attributeValue.expression.value !== null
        ) {
          return false;
        }
      }
      if (normalizedAttributeName === "aria-label") {
        if (attributeName !== "aria-label") return false;
        const labelValue =
          attributeValue && isNodeOfType(attributeValue, "JSXExpressionContainer")
            ? attributeValue.expression
            : attributeValue;
        hasLiteralLabel = Boolean(
          labelValue &&
          isNodeOfType(labelValue, "Literal") &&
          typeof labelValue.value === "string" &&
          labelValue.value.trim(),
        );
      }
    }
  }
  return hasLiteralLabel;
};
