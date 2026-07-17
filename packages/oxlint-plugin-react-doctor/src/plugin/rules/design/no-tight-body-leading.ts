import {
  LONG_BODY_TEXT_MIN_CHARACTERS,
  ROOT_FONT_SIZE_PX,
  TIGHT_LINE_HEIGHT_RATIO,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const BODY_TEXT_ELEMENT_NAMES = new Set(["blockquote", "dd", "figcaption", "li", "p", "td"]);
const TIGHT_LEADING_CLASS_NAMES = new Set(["leading-none", "leading-tight"]);

const getPixelValue = (property: EsTreeNode): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property)?.trim();
  if (!stringValue) return null;
  const pixelMatch = stringValue.match(/^([\d.]+)px$/);
  if (pixelMatch) return parseFloat(pixelMatch[1]);
  const remMatch = stringValue.match(/^([\d.]+)rem$/);
  return remMatch ? parseFloat(remMatch[1]) * ROOT_FONT_SIZE_PX : null;
};

const getUnitlessLineHeight = (property: EsTreeNode): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property)?.trim();
  if (!stringValue || !/^[\d.]+$/.test(stringValue)) return null;
  return parseFloat(stringValue);
};

export const noTightBodyLeading = defineRule({
  id: "no-tight-body-leading",
  title: "Body copy has cramped line spacing",
  severity: "warn",
  tags: ["design", "test-noise"],
  category: "Accessibility",
  recommendation: "Use a line height of at least 1.3 for multi-line body text.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return;
      if (!BODY_TEXT_ELEMENT_NAMES.has(openingElement.name.name)) return;
      const staticText = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (staticText.length < LONG_BODY_TEXT_MIN_CHARACTERS) return;

      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (
        classNameValue &&
        getClassNameTokens(classNameValue).some((token) => TIGHT_LEADING_CLASS_NAMES.has(token))
      ) {
        context.report({
          node: openingElement,
          message:
            "This line spacing is too tight for a long passage. Increase the leading so readers can track between lines.",
        });
        return;
      }

      for (const attribute of openingElement.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const styleExpression = getInlineStyleExpression(attribute);
        if (!styleExpression) continue;
        const fontSizeProperty = styleExpression.properties?.find(
          (property) => getStylePropertyKey(property) === "fontSize",
        );
        const lineHeightProperty = styleExpression.properties?.find(
          (property) => getStylePropertyKey(property) === "lineHeight",
        );
        if (!lineHeightProperty) continue;
        let lineHeightRatio = getUnitlessLineHeight(lineHeightProperty);
        if (lineHeightRatio === null && fontSizeProperty) {
          const fontSizePx = getPixelValue(fontSizeProperty);
          const lineHeightPx = getPixelValue(lineHeightProperty);
          if (fontSizePx && lineHeightPx) lineHeightRatio = lineHeightPx / fontSizePx;
        }
        if (lineHeightRatio === null || lineHeightRatio >= TIGHT_LINE_HEIGHT_RATIO) continue;
        context.report({
          node: lineHeightProperty,
          message: `This ${lineHeightRatio.toFixed(2)} line-height ratio crowds a long passage. Use at least ${TIGHT_LINE_HEIGHT_RATIO.toFixed(1)} for body copy.`,
        });
      }
    },
  }),
});
