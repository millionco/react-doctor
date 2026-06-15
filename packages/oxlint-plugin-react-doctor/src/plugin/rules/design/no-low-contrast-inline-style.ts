import {
  BOLD_FONT_WEIGHT_MIN,
  LARGE_BOLD_TEXT_MIN_PX,
  LARGE_TEXT_MIN_PX,
  WCAG_CONTRAST_LARGE_MIN,
  WCAG_CONTRAST_NORMAL_MIN,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { ParsedRgb } from "../../utils/parsed-rgb.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getWcagContrastRatio } from "./utils/get-wcag-contrast-ratio.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";

const UNRESOLVABLE = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "none",
]);

// Resolve a style color string to an OPAQUE rgb, or null when it can't be
// soundly resolved (alpha, keywords, CSS variables, hsl/oklch). We only
// flag pairs we can compute with certainty.
const resolveOpaqueColor = (raw: string): ParsedRgb | null => {
  const value = raw.trim().toLowerCase();
  if (UNRESOLVABLE.has(value)) return null;
  if (value === "white") return { red: 255, green: 255, blue: 255 };
  if (value === "black") return { red: 0, green: 0, blue: 0 };
  if (value.startsWith("var(")) return null;
  // Colors carrying alpha can't be judged without compositing — skip.
  if (/^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/.test(value)) return null;
  if (value.startsWith("hsl") || value.startsWith("oklch")) return null;
  // `rgb()`/`rgba()` with an alpha channel — the slash form (`rgb(0 0 0 / 50%)`)
  // or a 4th comma component (`rgb(0,0,0,0.5)` / `rgba(0,0,0,0.5)`).
  if (value.startsWith("rgb")) {
    const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
    if (inner.includes("/") || inner.split(",").length >= 4) return null;
  }
  return parseColorToRgb(value);
};

const toPx = (property: EsTreeNodeOfType<"Property">): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property);
  if (stringValue === null) return null;
  const pxMatch = stringValue.match(/^([\d.]+)px$/);
  if (pxMatch) return parseFloat(pxMatch[1]);
  const remMatch = stringValue.match(/^([\d.]+)rem$/);
  if (remMatch) return parseFloat(remMatch[1]) * 16;
  return null;
};

const isBoldWeight = (property: EsTreeNodeOfType<"Property">): boolean => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue >= BOLD_FONT_WEIGHT_MIN;
  const stringValue = getStylePropertyStringValue(property);
  if (stringValue === null) return false;
  if (stringValue === "bold" || stringValue === "bolder") return true;
  // Numeric weight written as a string, e.g. `fontWeight: "700"`.
  const numericWeight = Number(stringValue);
  return Number.isFinite(numericWeight) && numericWeight >= BOLD_FONT_WEIGHT_MIN;
};

export const noLowContrastInlineStyle = defineRule({
  id: "no-low-contrast-inline-style",
  title: "Low-contrast text in inline style",
  tags: ["test-noise"],
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Text needs a WCAG contrast ratio of at least 4.5:1 (3:1 for large/bold text) against its background. Darken or lighten one of the colors until it passes.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;
      const properties = expression.properties ?? [];
      // A `{...spread}` in the style object can override color/backgroundColor
      // at runtime, so we can't judge the static literals — bail.
      if (properties.some((property) => property.type === "SpreadElement")) {
        return;
      }

      let foreground: ParsedRgb | null = null;
      let backgroundColorRaw: string | null = null;
      let backgroundShorthandRaw: string | null = null;
      let backgroundIsUnknown = false;
      let fontSizePx: number | null = null;
      let isBold = false;

      for (const property of properties) {
        const key = getStylePropertyKey(property);
        if (!key) continue;
        if (key === "backgroundImage") {
          backgroundIsUnknown = true;
          continue;
        }
        if (key === "fontSize" && property.type === "Property") {
          fontSizePx = toPx(property);
          continue;
        }
        if (key === "fontWeight" && property.type === "Property") {
          isBold = isBoldWeight(property);
          continue;
        }
        const stringValue = getStylePropertyStringValue(property);
        if (key === "color") {
          if (stringValue !== null) foreground = resolveOpaqueColor(stringValue);
        } else if (key === "backgroundColor") {
          backgroundColorRaw = stringValue;
        } else if (key === "background") {
          // A non-string `background` (a CSS var, a gradient bound to an
          // expression, etc.) can't be judged — treat the surface as unknown.
          if (stringValue === null) backgroundIsUnknown = true;
          else backgroundShorthandRaw = stringValue;
        }
      }

      if (backgroundIsUnknown) return;
      // Both `backgroundColor` and the `background` shorthand on one element is
      // ambiguous about which actually paints behind the text — bail.
      if (backgroundColorRaw !== null && backgroundShorthandRaw !== null) return;

      // A `background` shorthand that doesn't resolve to a single opaque color
      // (gradient, image, multi-layer) paints the real background — `resolveOpaqueColor`
      // returns null for those, so `background` stays null and we skip below.
      const backgroundRaw = backgroundColorRaw ?? backgroundShorthandRaw;
      const background = backgroundRaw === null ? null : resolveOpaqueColor(backgroundRaw);
      if (!foreground || !background) return;

      // When the font size isn't in the inline style it may be set via a
      // class (`text-5xl`) — i.e. the text could be "large". To avoid false
      // positives on large text (which only needs 3:1), fall back to the
      // lenient large-text threshold whenever the size is unknown; only
      // apply the stricter 4.5:1 when we can see the size is normal.
      const couldBeLargeText =
        fontSizePx === null ||
        fontSizePx >= LARGE_TEXT_MIN_PX ||
        (isBold && fontSizePx >= LARGE_BOLD_TEXT_MIN_PX);
      const threshold = couldBeLargeText ? WCAG_CONTRAST_LARGE_MIN : WCAG_CONTRAST_NORMAL_MIN;
      const ratio = getWcagContrastRatio(foreground, background);
      if (ratio < threshold) {
        context.report({
          node,
          message: `Your users struggle to read this text: its contrast against the background is ${ratio.toFixed(2)}:1, below the ${threshold}:1 WCAG minimum, so darken or lighten one of the colors.`,
        });
      }
    },
  }),
});
