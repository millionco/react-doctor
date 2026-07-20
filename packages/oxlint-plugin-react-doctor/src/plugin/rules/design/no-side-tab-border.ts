import {
  SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX,
  SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX,
  SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
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
  ["borderTop", "top"],
  ["borderBottom", "bottom"],
  ["borderInlineStart", "left"],
  ["borderInlineEnd", "right"],
]);

const BORDER_SIDE_WIDTH_KEYS = new Set([
  "borderLeftWidth",
  "borderRightWidth",
  "borderTopWidth",
  "borderBottomWidth",
  "borderInlineStartWidth",
  "borderInlineEndWidth",
]);

const ARBITRARY_BORDER_COLOR_PATTERN = /\bborder(?:-([lrsetb]))?-\[([^\]]+)\]/g;
const NAMED_BORDER_COLOR_PATTERN =
  /\bborder(?:-([lrsetb]))?-((?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+|white|black|transparent)\b/g;
const NEUTRAL_NAMED_BORDER_COLOR_PATTERN =
  /^(?:(?:gray|slate|zinc|neutral|stone)-\d+|white|black|transparent)$/;

const hasSpinnerClass = (className: string): boolean =>
  /\bspinner\b/.test(className) ||
  (/\banimate-spin\b/.test(className) && /\brounded-full\b/.test(className));

export const noSideTabBorder = defineRule({
  id: "no-side-tab-border",
  title: "Thick one-sided border",
  tags: ["design", "test-noise"],
  severity: "warn",
  // Default off: subjective design / house-style preference, not a
  // correctness, performance, or accessibility issue. Opt in to enforce it.
  defaultEnabled: false,
  recommendation:
    "Use a softer accent like an inset box-shadow, a background, or a thin border-bottom instead of a thick one-sided border.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;
      const openingElement = isNodeOfType(node.parent, "JSXOpeningElement") ? node.parent : null;
      const className = openingElement ? getStringFromClassNameAttr(openingElement) : null;
      if (className && hasSpinnerClass(className)) return;

      let hasBorderRadius = false;
      const borderRadiusProperty = getEffectiveStyleProperty(expression.properties, "borderRadius");
      if (borderRadiusProperty) {
        const numValue = getStylePropertyNumberValue(borderRadiusProperty);
        const strValue = getStylePropertyStringValue(borderRadiusProperty);
        if (
          (numValue !== null && numValue > 0) ||
          (strValue !== null && parseFloat(strValue) > 0)
        ) {
          hasBorderRadius = true;
        }
      }
      const animationProperty = getEffectiveStyleProperty(expression.properties, "animation");
      const animationNameProperty = getEffectiveStyleProperty(
        expression.properties,
        "animationName",
      );
      const animationValue = animationProperty
        ? getStylePropertyStringValue(animationProperty)
        : null;
      const animationNameValue = animationNameProperty
        ? getStylePropertyStringValue(animationNameProperty)
        : null;
      if (hasBorderRadius && /spin/i.test(`${animationValue ?? ""} ${animationNameValue ?? ""}`)) {
        return;
      }

      const threshold = hasBorderRadius
        ? SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX
        : SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX;

      for (const [key, sideLabel] of BORDER_SIDE_KEYS) {
        const property = getEffectiveStyleProperty(expression.properties, key);
        if (!property) continue;
        if ((sideLabel === "top" || sideLabel === "bottom") && !hasBorderRadius) continue;
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
            message: `Your users see an off, dated thick border on one side (${sideLabel}: ${width}px), so use a softer accent or drop it.`,
          });
        }
      }

      for (const key of BORDER_SIDE_WIDTH_KEYS) {
        const property = getEffectiveStyleProperty(expression.properties, key);
        if (!property) continue;
        if ((key === "borderTopWidth" || key === "borderBottomWidth") && !hasBorderRadius) {
          continue;
        }
        const numValue = getStylePropertyNumberValue(property);
        const strValue = getStylePropertyStringValue(property);
        const width = numValue ?? (strValue !== null ? parseFloat(strValue) : NaN);
        if (isNaN(width)) continue;
        const colorKey = key.replace("Width", "Color");
        const colorProperty = getEffectiveStyleProperty(expression.properties, colorKey);
        const colorValue = colorProperty ? getStylePropertyStringValue(colorProperty) : null;
        if (colorValue === null || isNeutralBorderColor(colorValue)) continue;
        if (width >= threshold) {
          context.report({
            node: property,
            message: `Your users see an off, dated thick border on one side (${width}px), so use a softer accent or drop it.`,
          });
        }
      }
    },
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;
      if (hasSpinnerClass(classStr)) return;

      const sideMatch = classStr.match(/\bborder-([lrsetb])-(\d+)\b/);
      if (!sideMatch) return;
      const flaggedSideLetter = sideMatch[1];

      // The color that decides is the one scoped to the flagged side
      // (`border-l-[#e5e7eb]`, `border-l-red-500`), falling back to the
      // base border color (`border-[#e5e7eb]`, `border-gray-200`).
      // Arbitrary hex / rgb / hsl values run through the same chroma
      // check the inline-style path uses; achromatic borders are exempt.
      const isBorderColorNeutralBySide = new Map<string, boolean>();
      for (const namedColorMatch of classStr.matchAll(NAMED_BORDER_COLOR_PATTERN)) {
        isBorderColorNeutralBySide.set(
          namedColorMatch[1] ?? "",
          NEUTRAL_NAMED_BORDER_COLOR_PATTERN.test(namedColorMatch[2]),
        );
      }
      for (const arbitraryColorMatch of classStr.matchAll(ARBITRARY_BORDER_COLOR_PATTERN)) {
        const parsed = parseColorToRgb(arbitraryColorMatch[2]);
        if (parsed)
          isBorderColorNeutralBySide.set(arbitraryColorMatch[1] ?? "", !hasColorChroma(parsed));
      }
      const isDecidingBorderColorNeutral =
        isBorderColorNeutralBySide.get(flaggedSideLetter) ?? isBorderColorNeutralBySide.get("");
      if (isDecidingBorderColorNeutral) return;

      const width = parseInt(sideMatch[2], 10);
      const hasRounded =
        /\brounded(?:-(?!none\b)\w+)?\b/.test(classStr) && !/\brounded-none\b/.test(classStr);
      if ((flaggedSideLetter === "t" || flaggedSideLetter === "b") && !hasRounded) return;
      const tailwindThreshold = hasRounded
        ? SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX
        : SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS;

      if (width >= tailwindThreshold) {
        context.report({
          node,
          message: `Your users see an off, dated thick border on one side (${sideMatch[0]}), so use a softer accent or drop it.`,
        });
      }
    },
  }),
});
