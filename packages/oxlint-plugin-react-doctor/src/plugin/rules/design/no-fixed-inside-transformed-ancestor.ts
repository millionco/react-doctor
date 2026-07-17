import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const TRANSFORM_CLASS_PATTERN =
  /^(?:transform(?:-|$)|translate-|rotate-|scale-|skew-|perspective-|will-change-transform$)/;
const INERT_TRANSFORM_CLASSES = new Set([
  "perspective-none",
  "rotate-none",
  "scale-none",
  "transform-none",
  "translate-none",
]);

const hasStaticClass = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  predicate: (token: string) => boolean,
): boolean => {
  const className = getStringFromClassNameAttr(node);
  return Boolean(className && getUnvariantClassNameTokens(className).some(predicate));
};

const hasStaticInlineProperty = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  propertyName: string,
  expectedValue?: string,
): boolean => {
  const styleAttribute = node.attributes.find(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === "style",
  );
  const expression =
    styleAttribute && isNodeOfType(styleAttribute, "JSXAttribute")
      ? getInlineStyleExpression(styleAttribute)
      : null;
  const property = expression
    ? getEffectiveStyleProperty(expression.properties, propertyName)
    : null;
  if (!property) return false;
  const stringValue = getStylePropertyStringValue(property);
  if (expectedValue !== undefined) return stringValue === expectedValue;
  return stringValue !== null
    ? stringValue !== "none"
    : getStylePropertyNumberValue(property) !== null;
};

const isFixed = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  hasStaticClass(node, (token) => token === "fixed") ||
  hasStaticInlineProperty(node, "position", "fixed");

const isTransformed = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  hasStaticClass(
    node,
    (token) => !INERT_TRANSFORM_CLASSES.has(token) && TRANSFORM_CLASS_PATTERN.test(token),
  ) ||
  ["transform", "translate", "rotate", "scale", "perspective", "filter"].some((propertyName) =>
    hasStaticInlineProperty(node, propertyName),
  );

const getTransformedAncestor = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent?.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingElement = ancestor.openingElement;
      const tagName = resolveJsxElementType(openingElement);
      if (
        !/^[A-Z]/.test(tagName) &&
        !hasJsxSpreadAttribute(openingElement.attributes) &&
        isTransformed(openingElement)
      ) {
        return openingElement;
      }
    }
    ancestor = ancestor.parent;
  }
  return null;
};

export const noFixedInsideTransformedAncestor = defineRule({
  id: "no-fixed-inside-transformed-ancestor",
  title: "Fixed element is scoped by a transformed ancestor",
  severity: "warn",
  category: "Correctness",
  defaultEnabled: false,
  recommendation:
    "Move viewport-fixed UI outside transformed ancestors, or intentionally use absolute positioning within that containing block.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (hasJsxSpreadAttribute(node.attributes) || !isFixed(node)) return;
      if (!getTransformedAncestor(node)) return;
      context.report({
        node,
        message:
          "This fixed element sits inside a transformed ancestor, which makes that ancestor its containing block instead of the viewport. Move the overlay outside or use intentional local positioning.",
      });
    },
  }),
});
