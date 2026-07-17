import {
  MIN_PAGE_TYPE_SCALE_RATIO,
  PAGE_TYPE_SCALE_MIN_STEPS,
  ROOT_FONT_SIZE_PX,
  TAILWIND_TEXT_SIZE_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
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

const collectClassFontSizes = (classNameValue: string, fontSizes: Set<number>): void => {
  for (const token of getUnvariantClassNameTokens(classNameValue)) {
    const standardSize = TAILWIND_TEXT_SIZE_PX.get(token);
    if (standardSize !== undefined) {
      fontSizes.add(standardSize);
      continue;
    }
    const arbitrarySize = token.match(ARBITRARY_TEXT_SIZE_PATTERN);
    if (!arbitrarySize) continue;
    const value = parseFloat(arbitrarySize[1]);
    fontSizes.add(arbitrarySize[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value);
  }
};

const collectInlineFontSizes = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  fontSizes: Set<number>,
): void => {
  for (const attribute of openingElement.attributes ?? []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const styleExpression = getInlineStyleExpression(attribute);
    if (!styleExpression) continue;
    const property = getEffectiveStyleProperty(styleExpression.properties, "fontSize");
    if (!property) continue;
    const fontSizePx = getFontSizePx(property);
    if (fontSizePx !== null) fontSizes.add(fontSizePx);
  }
};

export const noFlatPageTypeScale = defineRule({
  id: "no-flat-page-type-scale",
  title: "Page typography uses a compressed size range",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use a clearer size hierarchy when a page declares several explicit typography steps.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        node.openingElement.name.name !== "main"
      ) {
        return;
      }
      const fontSizes = new Set<number>();
      for (const openingElement of getStaticJsxOpeningElements(node)) {
        const classNameValue = getStringFromClassNameAttr(openingElement);
        if (classNameValue) collectClassFontSizes(classNameValue, fontSizes);
        collectInlineFontSizes(openingElement, fontSizes);
      }
      if (fontSizes.size < PAGE_TYPE_SCALE_MIN_STEPS) return;
      const orderedSizes = [...fontSizes].sort((leftSize, rightSize) => leftSize - rightSize);
      const smallestSize = orderedSizes[0];
      const largestSize = orderedSizes.at(-1);
      if (
        !smallestSize ||
        !largestSize ||
        largestSize / smallestSize >= MIN_PAGE_TYPE_SCALE_RATIO
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message: `This page declares ${fontSizes.size} text sizes within less than a ${MIN_PAGE_TYPE_SCALE_RATIO}× range. Increase the hierarchy between supporting and display text.`,
      });
    },
  }),
});
