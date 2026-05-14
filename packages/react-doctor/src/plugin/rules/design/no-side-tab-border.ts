import {
  SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX,
  SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX,
  SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS,
} from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { hasColorChroma } from "./utils/has-color-chroma.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const isNeutralBorderColor = (value: string): boolean => {
  const trimmed = value.trim().toLowerCase();
  if (["gray", "grey", "silver", "white", "black", "transparent", "currentcolor"].includes(trimmed))
    return true;

  const parsed = parseColorToRgb(trimmed);
  if (parsed) return !hasColorChroma(parsed);

  return false;
};

const extractBorderColorFromShorthand = (shorthandValue: string): string | null => {
  const afterSolid = shorthandValue.match(/solid\s+(.+)$/i);
  if (!afterSolid) return null;
  return afterSolid[1].trim();
};

// HACK: Map (not plain object) so the `key in BORDER_SIDE_KEYS` guard
// below doesn't accept inherited Object.prototype names. Without this,
// any inline style object whose key happens to be `constructor` /
// `toString` / `hasOwnProperty` / `__proto__` would pass the membership
// check and fall through to a garbage report message that reads off
// `BORDER_SIDE_KEYS["constructor"]` (= the native Object function).
const BORDER_SIDE_KEYS = new Map<string, string>([
  ["borderLeft", "left"],
  ["borderRight", "right"],
  ["borderInlineStart", "left"],
  ["borderInlineEnd", "right"],
]);

const BORDER_SIDE_WIDTH_KEYS = new Set([
  "borderLeftWidth",
  "borderRightWidth",
  "borderInlineStartWidth",
  "borderInlineEndWidth",
]);

export const noSideTabBorder = defineRule<Rule>({
  tags: ["design", "test-noise"],
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Use a subtler accent (box-shadow inset, background gradient, or border-bottom) instead of a thick one-sided border",
  examples: [
    {
      before: '<div className="border-l-4 border-blue-500 p-4">Tab</div>',
      after: '<div className="shadow-[inset_2px_0_0_theme(colors.blue.500)] p-4">Tab</div>',
    },
  ],
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let hasBorderRadius = false;
      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (key === "borderRadius") {
          const numValue = getStylePropertyNumberValue(property);
          const strValue = getStylePropertyStringValue(property);
          if (
            (numValue !== null && numValue > 0) ||
            (strValue !== null && parseFloat(strValue) > 0)
          ) {
            hasBorderRadius = true;
          }
        }
      }

      const threshold = hasBorderRadius
        ? SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX
        : SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;

        const sideLabel = BORDER_SIDE_KEYS.get(key);
        if (sideLabel !== undefined) {
          const value = getStylePropertyStringValue(property);
          if (!value) continue;
          const widthMatch = value.match(/^(\d+)px\s+solid/);
          if (!widthMatch) continue;

          const borderColor = extractBorderColorFromShorthand(value);
          if (borderColor && isNeutralBorderColor(borderColor)) continue;

          const width = parseInt(widthMatch[1], 10);
          if (width >= threshold) {
            context.report({
              node: property,
              message: `Thick one-sided border (${sideLabel}: ${width}px) — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it`,
            });
          }
        }

        if (BORDER_SIDE_WIDTH_KEYS.has(key)) {
          const numValue = getStylePropertyNumberValue(property);
          const strValue = getStylePropertyStringValue(property);
          const width = numValue ?? (strValue !== null ? parseFloat(strValue) : NaN);
          if (isNaN(width)) continue;

          const colorKey = key.replace("Width", "Color");
          const hasColoredBorder = expression.properties?.some((colorProperty: EsTreeNode) => {
            const colorPropertyKey = getStylePropertyKey(colorProperty);
            if (colorPropertyKey !== colorKey) return false;
            const colorValue = getStylePropertyStringValue(colorProperty);
            return colorValue !== null && !isNeutralBorderColor(colorValue);
          });
          if (!hasColoredBorder) continue;

          if (width >= threshold) {
            context.report({
              node: property,
              message: `Thick one-sided border (${width}px) — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it`,
            });
          }
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;

      const sideMatch = classStr.match(/\bborder-[lrse]-(\d+)\b/);
      if (!sideMatch) return;

      const hasNeutralBorderColor =
        /\bborder-(?:(?:gray|slate|zinc|neutral|stone)-\d+|white|black|transparent)\b/.test(
          classStr,
        );
      if (hasNeutralBorderColor) return;

      const width = parseInt(sideMatch[1], 10);
      const hasRounded =
        /\brounded(?:-(?!none\b)\w+)?\b/.test(classStr) && !/\brounded-none\b/.test(classStr);
      const tailwindThreshold = hasRounded
        ? SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX
        : SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS;

      if (width >= tailwindThreshold) {
        context.report({
          node,
          message: `Thick one-sided border (${sideMatch[0]}) — the most recognizable tell of AI-generated UIs. Use a subtler accent or remove it`,
        });
      }
    },
  }),
});
