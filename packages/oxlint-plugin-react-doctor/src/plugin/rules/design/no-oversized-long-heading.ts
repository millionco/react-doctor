import {
  LONG_DISPLAY_HEADING_MIN_CHARACTERS,
  OVERSIZED_DISPLAY_HEADING_MIN_PX,
  ROOT_FONT_SIZE_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const OVERSIZED_TEXT_CLASS_NAMES = new Set(["text-7xl", "text-8xl", "text-9xl"]);
const ARBITRARY_TEXT_SIZE_PATTERN = /^text-\[([\d.]+)(px|rem)\](?:\/.+)?$/;

const getFontSizePx = (property: EsTreeNode): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property)?.trim();
  if (!stringValue) return null;
  const match = stringValue.match(/^([\d.]+)(px|rem)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return match[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
};

const hasOversizedClass = (classNameValue: string): boolean =>
  getUnvariantClassNameTokens(classNameValue).some((token) => {
    if (OVERSIZED_TEXT_CLASS_NAMES.has(token)) return true;
    const match = token.match(ARBITRARY_TEXT_SIZE_PATTERN);
    if (!match) return false;
    const value = parseFloat(match[1]);
    const pixels = match[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
    return pixels >= OVERSIZED_DISPLAY_HEADING_MIN_PX;
  });

export const noOversizedLongHeading = defineRule({
  id: "no-oversized-long-heading",
  title: "Long headline uses an oversized display scale",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Reduce the display size for sentence-length headlines, or tighten the copy before using a hero scale.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (
        !isNodeOfType(openingElement.name, "JSXIdentifier") ||
        openingElement.name.name !== "h1"
      ) {
        return;
      }
      const headingText = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (headingText.length < LONG_DISPLAY_HEADING_MIN_CHARACTERS) return;

      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (classNameValue && hasOversizedClass(classNameValue)) {
        context.report({
          node: openingElement,
          message:
            "This sentence-length headline is set at a hero display scale and can dominate the viewport. Reduce the size or shorten the copy.",
        });
        return;
      }

      for (const attribute of openingElement.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const styleExpression = getInlineStyleExpression(attribute);
        if (!styleExpression) continue;
        const fontSizeProperty = getEffectiveStyleProperty(styleExpression.properties, "fontSize");
        if (!fontSizeProperty) continue;
        const fontSizePx = getFontSizePx(fontSizeProperty);
        if (fontSizePx === null || fontSizePx < OVERSIZED_DISPLAY_HEADING_MIN_PX) continue;
        context.report({
          node: fontSizeProperty,
          message: `This long headline is set at ${fontSizePx}px and can crowd out the rest of the page. Use a smaller scale or shorter copy.`,
        });
      }
    },
  }),
});
