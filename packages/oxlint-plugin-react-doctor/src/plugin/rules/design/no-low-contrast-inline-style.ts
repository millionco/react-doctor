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
  if (value.startsWith("rgba(") || value.startsWith("hsl") || value.startsWith("oklch"))
    return null;
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
  return stringValue === "bold" || stringValue === "bolder";
};

export const noLowContrastInlineStyle = defineRule({
  id: "no-low-contrast-inline-style",
  title: "Low-contrast text in inline style",
  severity: "warn",
  category: "Accessibility",
  recommendation:
    "Text needs a WCAG contrast ratio of at least 4.5:1 (3:1 for large/bold text) against its background. Darken or lighten one of the colors until it passes.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;

      let foreground: ParsedRgb | null = null;
      let background: ParsedRgb | null = null;
      let fontSizePx: number | null = null;
      let isBold = false;
      let hasBackgroundImage = false;

      for (const property of expression.properties ?? []) {
        const key = getStylePropertyKey(property);
        if (!key) continue;
        if (key === "backgroundImage" || key === "background") {
          hasBackgroundImage = true;
          continue;
        }
        const stringValue = getStylePropertyStringValue(property);
        if (key === "color" && stringValue !== null) {
          foreground = resolveOpaqueColor(stringValue);
        } else if (key === "backgroundColor" && stringValue !== null) {
          background = resolveOpaqueColor(stringValue);
        } else if (key === "fontSize" && property.type === "Property") {
          fontSizePx = toPx(property);
        } else if (key === "fontWeight" && property.type === "Property") {
          isBold = isBoldWeight(property);
        }
      }

      // A `background`/`backgroundImage` could paint over backgroundColor; bail.
      if (hasBackgroundImage || !foreground || !background) return;

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
