import { WIDE_SHADOW_BLUR_MIN_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const WIDE_SHADOW_CLASS_NAMES = new Set(["shadow-xl", "shadow-2xl"]);
const HAIRLINE_BORDER_CLASS_NAMES = new Set(["border", "border-1", "border-px"]);

const hasOnePixelBorder = (properties: EsTreeNode[]): boolean => {
  const hasVisibleBorderStyle = properties.some(
    (property) =>
      getStylePropertyKey(property) === "borderStyle" &&
      /^(?:dashed|dotted|double|solid)$/.test(getStylePropertyStringValue(property)?.trim() ?? ""),
  );
  return properties.some((property) => {
    const propertyName = getStylePropertyKey(property);
    if (propertyName === "borderWidth") {
      const numberValue = getStylePropertyNumberValue(property);
      const stringValue = getStylePropertyStringValue(property)?.trim();
      return hasVisibleBorderStyle && (numberValue === 1 || stringValue === "1px");
    }
    if (propertyName !== "border") return false;
    const borderValue = getStylePropertyStringValue(property)?.trim() ?? "";
    return (
      !/\btransparent\b/.test(borderValue) && /^1px\s+(?:solid|dashed|dotted)\b/.test(borderValue)
    );
  });
};

const getShadowBlurPx = (value: string): number | null => {
  const shadowGeometry = value.split(/(?:rgba?|hsla?|oklch|oklab|lab|lch|hwb|color)\(|#/i)[0];
  const lengths = [...shadowGeometry.matchAll(/-?[\d.]+px|(?<![\d.])0(?![\d.])/g)].map((match) =>
    Math.abs(parseFloat(match[0])),
  );
  return lengths.length >= 3 ? lengths[2] : null;
};

export const noHairlineBorderWideShadow = defineRule({
  id: "no-hairline-border-wide-shadow",
  title: "Hairline border is paired with a diffuse shadow",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation: "Choose either a defined edge or soft elevation instead of emphasizing both.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const styleExpression = getInlineStyleExpression(node);
      if (!styleExpression || !hasOnePixelBorder(styleExpression.properties ?? [])) return;
      for (const property of styleExpression.properties ?? []) {
        if (getStylePropertyKey(property) !== "boxShadow") continue;
        const shadowValue = getStylePropertyStringValue(property);
        if (!shadowValue || /\btransparent\b/.test(shadowValue)) continue;
        const shadowBlurPx = getShadowBlurPx(shadowValue);
        if (shadowBlurPx === null || shadowBlurPx < WIDE_SHADOW_BLUR_MIN_PX) continue;
        context.report({
          node: property,
          message:
            "This surface combines a crisp hairline edge with a broad diffuse shadow. Pick one elevation signal to keep the shape clear.",
        });
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const tokens = new Set(getUnvariantClassNameTokens(classNameValue));
      if (
        tokens.has("border-0") ||
        tokens.has("border-none") ||
        tokens.has("border-transparent") ||
        ![...HAIRLINE_BORDER_CLASS_NAMES].some((token) => tokens.has(token))
      ) {
        return;
      }
      if (tokens.has("shadow-none") || tokens.has("shadow-transparent")) return;
      if (![...WIDE_SHADOW_CLASS_NAMES].some((token) => tokens.has(token))) return;
      context.report({
        node,
        message:
          "This surface uses both a hairline border and a large diffuse shadow. Keep one clear depth treatment.",
      });
    },
  }),
});
