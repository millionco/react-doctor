import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const INSET_PROPERTY_NAMES = [
  "inset",
  "insetBlock",
  "insetBlockEnd",
  "insetBlockStart",
  "insetInline",
  "insetInlineEnd",
  "insetInlineStart",
  "top",
  "right",
  "bottom",
  "left",
] as const;

const hasNonAutoInsetClass = (className: string | null): boolean =>
  Boolean(
    className &&
    getUnvariantClassNameTokens(className).some(
      (token) =>
        /^-?(?:inset(?:-[xy])?|top|right|bottom|left|start|end)-/.test(token) &&
        !token.endsWith("-auto"),
    ),
  );

const getStyleExpression = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"ObjectExpression"> | null => {
  const styleAttribute = findJsxAttribute(node.attributes, "style");
  return styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
};

const hasNonAutoInlineInset = (
  expression: EsTreeNodeOfType<"ObjectExpression"> | null,
): boolean => {
  if (!expression) return false;
  return INSET_PROPERTY_NAMES.some((propertyName) => {
    const property = getEffectiveStyleProperty(expression.properties, propertyName);
    if (!property) return false;
    return getStylePropertyStringValue(property) !== "auto";
  });
};

export const noInertStickyPosition = defineRule({
  id: "no-inert-sticky-position",
  title: "Sticky positioning has no inset",
  severity: "warn",
  category: "Correctness",
  defaultEnabled: false,
  recommendation:
    "Set a non-auto inset such as top, bottom, inset-block-start, or its matching Tailwind utility on the sticky axis.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (hasJsxSpreadAttribute(node.attributes)) return;
      const className = getStringFromClassNameAttr(node);
      const expression = getStyleExpression(node);
      const positionProperty = expression
        ? getEffectiveStyleProperty(expression.properties, "position")
        : null;
      const hasStaticStickyClass = Boolean(
        className && getUnvariantClassNameTokens(className).includes("sticky"),
      );
      const hasInlineSticky = Boolean(
        positionProperty && getStylePropertyStringValue(positionProperty) === "sticky",
      );
      if (!hasStaticStickyClass && !hasInlineSticky) return;
      if (hasNonAutoInsetClass(className) || hasNonAutoInlineInset(expression)) return;
      const reportNode: EsTreeNode = positionProperty ?? node;
      if (isNodeOfType(reportNode, "Property") || isNodeOfType(reportNode, "JSXOpeningElement")) {
        context.report({
          node: reportNode,
          message:
            "This element is sticky but has no non-auto inset, so it behaves like relative positioning instead of sticking. Set an inset on the sticky axis.",
        });
      }
    },
  }),
});
