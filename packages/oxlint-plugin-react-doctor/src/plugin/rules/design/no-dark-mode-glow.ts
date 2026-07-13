import {
  DARK_BACKGROUND_CHANNEL_MAX,
  DARK_GLOW_BLUR_THRESHOLD_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { ParsedRgb } from "../../utils/parsed-rgb.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { hasColorChroma } from "./utils/has-color-chroma.js";
import { isPureBlackColor } from "./utils/is-pure-black-color.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const splitShadowLayers = (shadowValue: string): string[] => {
  const layers: string[] = [];
  let layerStartIndex = 0;
  let parenthesisDepth = 0;

  for (let characterIndex = 0; characterIndex < shadowValue.length; characterIndex += 1) {
    const character = shadowValue[characterIndex];
    if (character === "(") parenthesisDepth += 1;
    if (character === ")" && parenthesisDepth > 0) parenthesisDepth -= 1;
    if (character !== "," || parenthesisDepth !== 0) continue;

    layers.push(shadowValue.slice(layerStartIndex, characterIndex));
    layerStartIndex = characterIndex + 1;
  }

  layers.push(shadowValue.slice(layerStartIndex));
  return layers;
};

const RGB_COLOR_PATTERN = /rgba?\([^)]*\)/i;
const HEX_COLOR_PATTERN = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/i;
const ZERO_ALPHA_PATTERN = /^[+-]?(?:0+(?:\.0*)?|\.0+)%?$/;

const isAtTopLevel = (value: string, index: number): boolean => {
  let parenthesisDepth = 0;
  for (let characterIndex = 0; characterIndex < index; characterIndex += 1) {
    const character = value[characterIndex];
    if (character === "(") parenthesisDepth += 1;
    if (character === ")" && parenthesisDepth > 0) parenthesisDepth -= 1;
  }
  return parenthesisDepth === 0;
};

const isShadowLayerFullyTransparent = (layer: string): boolean => {
  const hexMatch = layer.match(HEX_COLOR_PATTERN);
  if (hexMatch?.index !== undefined && isAtTopLevel(layer, hexMatch.index)) {
    const hexDigits = hexMatch[0].slice(1);
    if (hexDigits.length === 4) return hexDigits.endsWith("0");
    if (hexDigits.length === 8) return hexDigits.endsWith("00");
  }

  const rgbMatch = layer.match(RGB_COLOR_PATTERN);
  if (rgbMatch?.index === undefined || !isAtTopLevel(layer, rgbMatch.index)) return false;

  const colorArguments = rgbMatch[0].slice(rgbMatch[0].indexOf("(") + 1, -1);
  const slashIndex = colorArguments.lastIndexOf("/");
  if (slashIndex !== -1) {
    return ZERO_ALPHA_PATTERN.test(colorArguments.slice(slashIndex + 1).trim());
  }

  const legacyArguments = colorArguments.split(",");
  return legacyArguments.length === 4 && ZERO_ALPHA_PATTERN.test(legacyArguments[3].trim());
};

const extractColorFromShadowLayer = (layer: string): ParsedRgb | null => {
  const colorMatch = layer.match(RGB_COLOR_PATTERN) ?? layer.match(HEX_COLOR_PATTERN);
  return colorMatch ? parseColorToRgb(colorMatch[0]) : null;
};

const RGB_FUNCTION_PATTERN = /rgba?\([^)]*\)/gi;
const ALL_HEX_COLORS_PATTERN = /#[0-9a-f]{3,8}\b/gi;
const NUMERIC_TOKEN_PATTERN = /(\d+(?:\.\d+)?)(px)?/g;

// The blur radius is the third numeric token (`offset-x offset-y blur`).
const SHADOW_BLUR_TOKEN_INDEX = 2;

const parseShadowLayerBlur = (layer: string): number => {
  const withoutColors = layer.replace(RGB_FUNCTION_PATTERN, "").replace(ALL_HEX_COLORS_PATTERN, "");
  let tokenIndex = 0;
  for (const match of withoutColors.matchAll(NUMERIC_TOKEN_PATTERN)) {
    if (tokenIndex === SHADOW_BLUR_TOKEN_INDEX) return parseFloat(match[1]);
    tokenIndex += 1;
  }
  return 0;
};

const hasColoredGlowShadow = (shadowValue: string): boolean => {
  for (const layer of splitShadowLayers(shadowValue)) {
    if (isShadowLayerFullyTransparent(layer)) continue;

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

export const noDarkModeGlow = defineRule({
  id: "no-dark-mode-glow",
  title: "Colored glow on dark background",
  tags: ["design", "test-noise"],
  severity: "warn",
  // Default off: subjective design / house-style preference, not a
  // correctness, performance, or accessibility issue. Opt in to enforce it.
  defaultEnabled: false,
  recommendation:
    "Use a subtle `box-shadow` in neutral colors for depth, or a faint `border`. Colored glows on dark backgrounds look overdone.",
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
            "A strong colored glow on a dark background can feel heavy. Use a subtle, neutral shadow instead.",
        });
      }
    },
  }),
});
