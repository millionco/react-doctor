import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { hasVisibleTailwindShadow } from "./utils/has-visible-tailwind-fill-or-edge.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";

const SHADOW_COLOR_PATTERN = /\bblack\b|#[0-9a-f]{3,8}\b|(?:rgb|hsl)a?\([^)]*\)/gi;
const FULLY_TRANSPARENT_HEX_PATTERN = /^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i;
const FULLY_TRANSPARENT_FUNCTION_PATTERN = /(?:,|\/)\s*(?:0+(?:\.0*)?|\.0+)%?\s*\)$/;
const FULLY_TRANSPARENT_TAILWIND_BLACK_PATTERN =
  /^shadow-black\/(?:0+(?:\.0*)?|\.0+|\[(?:0+(?:\.0*)?|\.0+)%?\])$/;

const hasPureBlackShadowColor = (shadowValue: string): boolean => {
  for (const colorMatch of shadowValue.replace(/_/g, " ").matchAll(SHADOW_COLOR_PATTERN)) {
    const color = colorMatch[0];
    if (
      FULLY_TRANSPARENT_HEX_PATTERN.test(color) ||
      FULLY_TRANSPARENT_FUNCTION_PATTERN.test(color)
    ) {
      continue;
    }
    if (color.toLowerCase() === "black") return true;
    const parsedColor = parseColorToRgb(color);
    if (parsedColor?.red === 0 && parsedColor.green === 0 && parsedColor.blue === 0) return true;
  }
  return false;
};

const isVisibleTailwindBlackShadow = (token: string): boolean =>
  (token === "shadow-black" || token.startsWith("shadow-black/")) &&
  !FULLY_TRANSPARENT_TAILWIND_BLACK_PATTERN.test(token);

export const noPureBlackShadow = defineRule({
  id: "no-pure-black-shadow",
  title: "Surface uses a pure-black shadow",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Tint shadows toward the surrounding surface or use a softer neutral token instead of pure black.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const styleExpression = getInlineStyleExpression(node);
      if (!styleExpression) return;
      const property = getEffectiveStyleProperty(styleExpression.properties, "boxShadow");
      if (!property) return;
      const shadowValue = getStylePropertyStringValue(property);
      if (!shadowValue || !hasPureBlackShadowColor(shadowValue)) return;
      context.report({
        node: property,
        message:
          "This shadow uses pure black, which can look detached from the surface beneath it. Use a tinted or neutral design token.",
      });
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      if (!hasVisibleTailwindShadow(tokens)) return;
      const hasBlackColor = tokens.some(isVisibleTailwindBlackShadow);
      const hasArbitraryBlackShadow = tokens.some(
        (token) => token.startsWith("shadow-[") && hasPureBlackShadowColor(token),
      );
      if (!hasBlackColor && !hasArbitraryBlackShadow) return;
      context.report({
        node,
        message:
          "This shadow uses pure black as its color. Tint it toward the surrounding surface or use a neutral shadow token.",
      });
    },
  }),
});
