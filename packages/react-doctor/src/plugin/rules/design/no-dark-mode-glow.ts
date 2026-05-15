import {
  DARK_BACKGROUND_CHANNEL_MAX,
  DARK_GLOW_BLUR_THRESHOLD_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { ParsedRgb } from "../../utils/parsed-rgb.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { hasColorChroma } from "./utils/has-color-chroma.js";
import { isPureBlackColor } from "./utils/is-pure-black-color.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const splitShadowLayers = (shadowValue: string): string[] => shadowValue.split(/,(?![^(]*\))/);

const extractColorFromShadowLayer = (layer: string): ParsedRgb | null => {
  const rgbMatch = layer.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return {
      red: parseInt(rgbMatch[1], 10),
      green: parseInt(rgbMatch[2], 10),
      blue: parseInt(rgbMatch[3], 10),
    };
  }

  const hexMatch = layer.match(/#([0-9a-f]{3,6})\b/i);
  if (hexMatch) return parseColorToRgb(`#${hexMatch[1]}`);

  return null;
};

const parseShadowLayerBlur = (layer: string): number => {
  const withoutColors = layer.replace(/rgba?\([^)]*\)/g, "").replace(/#[0-9a-f]{3,8}\b/gi, "");
  const numericTokens = [...withoutColors.matchAll(/(\d+(?:\.\d+)?)(px)?/g)].map((match) =>
    parseFloat(match[1]),
  );
  return numericTokens.length >= 3 ? numericTokens[2] : 0;
};

const hasColoredGlowShadow = (shadowValue: string): boolean => {
  for (const layer of splitShadowLayers(shadowValue)) {
    const color = extractColorFromShadowLayer(layer);
    if (
      color &&
      hasColorChroma(color) &&
      parseShadowLayerBlur(layer) > DARK_GLOW_BLUR_THRESHOLD_PX
    ) {
      return true;
    }
  }
  return false;
};

const isBackgroundDark = (bgValue: string): boolean => {
  const trimmed = bgValue.trim().toLowerCase();
  if (isPureBlackColor(trimmed)) return true;

  const parsed = parseColorToRgb(trimmed);
  if (!parsed) return false;

  return (
    parsed.red <= DARK_BACKGROUND_CHANNEL_MAX &&
    parsed.green <= DARK_BACKGROUND_CHANNEL_MAX &&
    parsed.blue <= DARK_BACKGROUND_CHANNEL_MAX
  );
};

export const noDarkModeGlow = defineRule<Rule>({
  id: "no-dark-mode-glow",
  tags: ["design", "test-noise"],
  severity: "warn",
  recommendation:
    "Use a subtle `box-shadow` with neutral colors for depth, or `border` with low opacity. Colored glows on dark backgrounds are the default AI-generated aesthetic",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let hasDarkBackground = false;
      let shadowProperty: EsTreeNode | null = null;
      let shadowValue: string | null = null;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        if (key === "backgroundColor" || key === "background") {
          const value = getStylePropertyStringValue(property);
          if (value && isBackgroundDark(value)) {
            hasDarkBackground = true;
          }
        }

        if (key === "boxShadow") {
          shadowProperty = property;
          shadowValue = getStylePropertyStringValue(property);
        }
      }

      if (!hasDarkBackground || !shadowValue || !shadowProperty) return;

      if (hasColoredGlowShadow(shadowValue)) {
        context.report({
          node: shadowProperty,
          message:
            "Colored glow on dark background — the default AI-generated 'cool' look. Use subtle, purposeful lighting instead",
        });
      }
    },
  }),
});
