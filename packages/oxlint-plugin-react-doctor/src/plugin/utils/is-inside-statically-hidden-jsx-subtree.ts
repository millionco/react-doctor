import { getEffectiveStyleProperty } from "../rules/design/utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "../rules/design/utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "../rules/design/utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "../rules/design/utils/get-style-property-string-value.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "./get-authoritative-jsx-attribute.js";
import { getTailwindVisibilityAtBreakpoints } from "./get-tailwind-visibility-at-breakpoints.js";
import { isHiddenFromScreenReader } from "./is-hidden-from-screen-reader.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { RuleContext } from "./rule-context.js";

const isStaticallyHiddenOpeningElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  if (isHiddenFromScreenReader(openingElement, context.settings)) return true;
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  const styleExpression = styleAttribute
    ? getInlineStyleExpression(styleAttribute, context.scopes)
    : null;
  if (styleExpression) {
    const displayProperty = getEffectiveStyleProperty(styleExpression.properties, "display");
    if (displayProperty && getStylePropertyStringValue(displayProperty)?.toLowerCase() === "none") {
      return true;
    }
    const visibilityProperty = getEffectiveStyleProperty(styleExpression.properties, "visibility");
    const visibilityValue = visibilityProperty
      ? getStylePropertyStringValue(visibilityProperty)?.toLowerCase()
      : null;
    if (visibilityValue === "hidden" || visibilityValue === "collapse") return true;
  }
  const className = getStringFromClassNameAttr(openingElement);
  if (!className) return false;
  const visibilityAtBreakpoints = getTailwindVisibilityAtBreakpoints(className);
  return Boolean(
    visibilityAtBreakpoints && visibilityAtBreakpoints.every((isVisible) => !isVisible),
  );
};

export const isInsideStaticallyHiddenJsxSubtree = (
  node: EsTreeNode,
  context: RuleContext,
): boolean => {
  let currentNode: EsTreeNode | null | undefined = node;
  while (currentNode) {
    if (
      isNodeOfType(currentNode, "JSXElement") &&
      isStaticallyHiddenOpeningElement(currentNode.openingElement, context)
    ) {
      return true;
    }
    currentNode = currentNode.parent;
  }
  return false;
};
