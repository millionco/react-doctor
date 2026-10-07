import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getElementType } from "./get-element-type.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { getStringLiteralAttributeValue } from "./get-string-literal-attribute-value.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveStaticJsxAttribute } from "./resolve-static-jsx-attribute.js";
import type { StaticJsxAttributeResolution } from "./resolve-static-jsx-attribute.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const getResolvedStaticString = (resolution: StaticJsxAttributeResolution): string | null =>
  resolution.attribute
    ? getStringLiteralAttributeValue(resolution.attribute)
    : getStaticStringExpression(resolution.expression);

const getResolvedExpression = (resolution: StaticJsxAttributeResolution): EsTreeNode | null => {
  const expression = resolution.expression ?? resolution.attribute?.value;
  if (!expression) return null;
  return stripParenExpression(
    isNodeOfType(expression, "JSXExpressionContainer") ? expression.expression : expression,
  );
};

export const isHiddenFromScreenReader = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  const tag = getElementType(openingElement, settings);
  if (tag.toLowerCase() === "input") {
    const typeResolution = resolveStaticJsxAttribute(openingElement.attributes, "type", false);
    const typeValue = getResolvedStaticString(typeResolution);
    if (typeValue?.toLowerCase() === "hidden") return true;
  }

  const hiddenResolution = resolveStaticJsxAttribute(openingElement.attributes, "hidden", false);
  if (hiddenResolution.isPresent) {
    if (hiddenResolution.attribute && !hiddenResolution.attribute.value) return true;
    const staticStringValue = getResolvedStaticString(hiddenResolution);
    if (staticStringValue !== null) return staticStringValue.length > 0;
    const hiddenExpression = getResolvedExpression(hiddenResolution);
    if (isNodeOfType(hiddenExpression, "Literal") && Boolean(hiddenExpression.value)) return true;
  }

  const ariaHiddenResolution = resolveStaticJsxAttribute(
    openingElement.attributes,
    "aria-hidden",
    false,
  );
  if (!ariaHiddenResolution.isPresent) return false;
  const staticStringValue = getResolvedStaticString(ariaHiddenResolution);
  if (staticStringValue !== null) return staticStringValue.toLowerCase() === "true";
  if (ariaHiddenResolution.attribute && !ariaHiddenResolution.attribute.value) return true;
  const ariaHiddenExpression = getResolvedExpression(ariaHiddenResolution);
  if (isNodeOfType(ariaHiddenExpression, "Literal")) {
    return (
      ariaHiddenExpression.value === true ||
      ariaHiddenExpression.value?.toString().toLowerCase() === "true"
    );
  }
  return false;
};
