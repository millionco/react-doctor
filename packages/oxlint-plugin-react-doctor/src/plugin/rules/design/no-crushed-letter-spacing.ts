import { CRUSHED_TRACKING_THRESHOLD_EM, ROOT_FONT_SIZE_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const ARBITRARY_TRACKING_PATTERN = /^tracking-\[(-?[\d.]+)(em|px)\]$/;

const getTrackingEm = (property: EsTreeNode): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue / ROOT_FONT_SIZE_PX;
  const stringValue = getStylePropertyStringValue(property)?.trim();
  if (!stringValue) return null;
  const match = stringValue.match(/^(-?[\d.]+)(em|px)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return match[2] === "em" ? value : value / ROOT_FONT_SIZE_PX;
};

const getArbitraryTrackingEm = (classNameValue: string): number | null => {
  for (const token of getClassNameTokens(classNameValue)) {
    const match = token.match(ARBITRARY_TRACKING_PATTERN);
    if (!match) continue;
    const value = parseFloat(match[1]);
    return match[2] === "em" ? value : value / ROOT_FONT_SIZE_PX;
  }
  return null;
};

export const noCrushedLetterSpacing = defineRule({
  id: "no-crushed-letter-spacing",
  title: "Letter spacing compresses text excessively",
  severity: "warn",
  tags: ["design", "test-noise"],
  category: "Accessibility",
  recommendation: "Loosen the tracking until each character keeps a distinct, readable shape.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const styleExpression = getInlineStyleExpression(node);
      if (!styleExpression) return;
      const jsxElement = node.parent?.parent;
      if (!isNodeOfType(jsxElement, "JSXElement") || !getStaticJsxText(jsxElement).trim()) return;
      const property = getEffectiveStyleProperty(styleExpression.properties, "letterSpacing");
      if (!property) return;
      const trackingEm = getTrackingEm(property);
      if (trackingEm === null || trackingEm >= CRUSHED_TRACKING_THRESHOLD_EM) return;
      context.report({
        node: property,
        message: `This ${trackingEm.toFixed(2)}em tracking compresses the letterforms and hurts readability. Use a less aggressive value.`,
      });
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const jsxElement = node.parent;
      if (!isNodeOfType(jsxElement, "JSXElement") || !getStaticJsxText(jsxElement).trim()) return;
      const trackingEm = getArbitraryTrackingEm(classNameValue);
      if (trackingEm === null || trackingEm >= CRUSHED_TRACKING_THRESHOLD_EM) return;
      context.report({
        node,
        message: `This ${trackingEm.toFixed(2)}em tracking crowds the characters together. Loosen it to preserve legibility.`,
      });
    },
  }),
});
