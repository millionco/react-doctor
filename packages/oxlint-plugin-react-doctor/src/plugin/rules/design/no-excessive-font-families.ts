import { EXCESSIVE_FONT_FAMILY_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxOpeningElements } from "../../utils/get-static-jsx-opening-elements.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const FONT_WEIGHT_CLASS_NAMES = new Set([
  "font-black",
  "font-bold",
  "font-extrabold",
  "font-extralight",
  "font-light",
  "font-medium",
  "font-normal",
  "font-semibold",
  "font-thin",
]);

const isFontFamilyClassName = (token: string): boolean => {
  if (!token.startsWith("font-") || FONT_WEIGHT_CLASS_NAMES.has(token)) return false;
  if (/^font-(?:stretch|width)-/.test(token)) return false;
  return !/^font-\[(?:\d+|(?:font-)?weight:|var\(--[^\]]*weight)/.test(token);
};

const collectFontFamilies = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  fontFamilies: Set<string>,
): void => {
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (classNameValue) {
    for (const token of getUnvariantClassNameTokens(classNameValue)) {
      if (isFontFamilyClassName(token)) {
        fontFamilies.add(token.toLowerCase());
      }
    }
  }
  for (const attribute of openingElement.attributes) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const styleExpression = getInlineStyleExpression(attribute);
    if (!styleExpression) continue;
    const property = getEffectiveStyleProperty(styleExpression.properties, "fontFamily");
    const fontFamilyValue = property && getStylePropertyStringValue(property)?.trim();
    if (!fontFamilyValue || fontFamilyValue.includes("var(")) continue;
    fontFamilies.add(fontFamilyValue.split(",")[0].replace(/["']/g, "").trim().toLowerCase());
  }
};

export const noExcessiveFontFamilies = defineRule({
  id: "no-excessive-font-families",
  title: "Page mixes too many font families",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use a display face, a body face, and at most one purposeful outlier such as monospace.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const fontFamilies = new Set<string>();
      for (const openingElement of getStaticJsxOpeningElements(node)) {
        collectFontFamilies(openingElement, fontFamilies);
      }
      if (fontFamilies.size < EXCESSIVE_FONT_FAMILY_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page uses ${fontFamilies.size} literal font families. Reduce the palette so typography communicates a coherent hierarchy.`,
      });
    },
  }),
});
