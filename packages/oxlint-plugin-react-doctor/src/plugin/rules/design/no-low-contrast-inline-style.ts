import {
  BOLD_FONT_WEIGHT_MIN,
  LARGE_BOLD_TEXT_MIN_PX,
  LARGE_TEXT_MIN_PX,
  ROOT_FONT_SIZE_PX,
  WCAG_CONTRAST_LARGE_MIN,
  WCAG_CONTRAST_NORMAL_MIN,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { ParsedRgb } from "../../utils/parsed-rgb.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getCssFunctionContents } from "./utils/get-css-function-contents.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getWcagContrastRatio } from "./utils/get-wcag-contrast-ratio.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { splitCssTopLevel } from "./utils/split-css-top-level.js";

const UNRESOLVABLE = new Set([
  "transparent",
  "currentcolor",
  "inherit",
  "initial",
  "unset",
  "revert",
  "none",
]);
const GRADIENT_FUNCTION_PATTERN = /^(?:linear|radial|conic)-gradient\(/i;
const GRADIENT_PRELUDE_PATTERN =
  /^(?:to\b|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|grad|rad|turn)\b|circle\b|ellipse\b|closest-|farthest-|\bat\b|from\b|in\b)/i;
const GRADIENT_STOP_POSITION_PATTERN =
  /^(?:[+-]?0|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px|rem|em|deg|grad|rad|turn))(?:\s+(?:[+-]?0|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px|rem|em|deg|grad|rad|turn)))?$/i;

// Resolve a style color string to an OPAQUE rgb, or null when it can't be
// soundly resolved (alpha, keywords, CSS variables, oklch). We only
// flag pairs we can compute with certainty.
const resolveOpaqueColor = (raw: string): ParsedRgb | null => {
  const value = raw.trim().toLowerCase();
  if (UNRESOLVABLE.has(value)) return null;
  if (value === "white") return { red: 255, green: 255, blue: 255 };
  if (value === "black") return { red: 0, green: 0, blue: 0 };
  if (value.startsWith("var(")) return null;
  // Colors carrying alpha can't be judged without compositing — skip.
  if (/^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/.test(value)) return null;
  if (value.startsWith("oklch")) return null;
  // `rgb()`/`hsl()` with an alpha channel — the slash form or a 4th comma component.
  if (value.startsWith("rgba(") || value.startsWith("hsla(")) return null;
  if (value.startsWith("rgb(") || value.startsWith("hsl(")) {
    const inner = value.slice(value.indexOf("(") + 1, value.lastIndexOf(")"));
    if (inner.includes("/") || inner.split(",").length >= 4) return null;
  }
  return parseColorToRgb(value);
};

const getFunctionalColorEndIndex = (value: string): number | null => {
  const openingParenthesisIndex = value.indexOf("(");
  if (openingParenthesisIndex < 0) return null;
  let depth = 0;
  for (
    let characterIndex = openingParenthesisIndex;
    characterIndex < value.length;
    characterIndex += 1
  ) {
    const character = value[characterIndex];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return null;
    if (depth === 0) return characterIndex + 1;
  }
  return null;
};

const parseOpaqueGradientStop = (stop: string): ParsedRgb | null => {
  const trimmedStop = stop.trim();
  let colorEndIndex = 0;
  if (/^(?:rgb|hsl)a?\(/i.test(trimmedStop)) {
    const functionalColorEndIndex = getFunctionalColorEndIndex(trimmedStop);
    if (functionalColorEndIndex === null) return null;
    colorEndIndex = functionalColorEndIndex;
  } else {
    const colorMatch = trimmedStop.match(/^(?:#[\da-f]+|white|black)(?=\s|$)/i);
    if (!colorMatch) return null;
    colorEndIndex = colorMatch[0].length;
  }
  const color = resolveOpaqueColor(trimmedStop.slice(0, colorEndIndex));
  if (!color) return null;
  const position = trimmedStop.slice(colorEndIndex).trim();
  return !position || GRADIENT_STOP_POSITION_PATTERN.test(position) ? color : null;
};

const parseOpaqueGradientStops = (raw: string): ParsedRgb[] | null => {
  const value = raw.trim();
  if (/var\(/i.test(value)) return null;
  if (!GRADIENT_FUNCTION_PATTERN.test(value)) return null;
  const contents = getCssFunctionContents(value);
  if (contents === null) return null;
  const parts = splitCssTopLevel(contents, ",");
  if (!parts || parts.length < 2) return null;
  const firstStop = parseOpaqueGradientStop(parts[0]);
  const stopParts =
    firstStop === null && GRADIENT_PRELUDE_PATTERN.test(parts[0]) ? parts.slice(1) : parts;
  if (stopParts.length < 2) return null;
  const stops = stopParts.map(parseOpaqueGradientStop);
  return stops.every((stop): stop is ParsedRgb => stop !== null) ? stops : null;
};

const toPx = (property: EsTreeNodeOfType<"Property">): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property);
  if (stringValue === null) return null;
  const pxMatch = stringValue.match(/^([\d.]+)px$/);
  if (pxMatch) return parseFloat(pxMatch[1]);
  const remMatch = stringValue.match(/^([\d.]+)rem$/);
  if (remMatch) return parseFloat(remMatch[1]) * ROOT_FONT_SIZE_PX;
  return null;
};

const resolveBoldWeight = (property: EsTreeNodeOfType<"Property">): boolean | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue >= BOLD_FONT_WEIGHT_MIN;
  const stringValue = getStylePropertyStringValue(property);
  if (stringValue === null) return null;
  if (stringValue === "bold" || stringValue === "bolder") return true;
  if (stringValue === "normal" || stringValue === "lighter") return false;
  // Numeric weight written as a string, e.g. `fontWeight: "700"`.
  const numericWeight = Number(stringValue);
  return Number.isFinite(numericWeight) ? numericWeight >= BOLD_FONT_WEIGHT_MIN : null;
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
      // A dynamic key or spread can override a color at runtime, so the static
      // literals do not prove the effective contrast.
      if (
        properties.some(
          (property) => property.type === "SpreadElement" || getStylePropertyKey(property) === null,
        )
      ) {
        return;
      }

      let foreground: ParsedRgb | null = null;
      let backgroundColorRaw: string | null = null;
      let backgroundShorthandRaw: string | null = null;
      let backgroundImageRaw: string | null = null;
      let backgroundColorIsUnknown = false;
      let backgroundShorthandIsUnknown = false;
      let backgroundImageIsUnknown = false;
      let backgroundClipRaw: string | null = null;
      let webkitBackgroundClipRaw: string | null = null;
      let backgroundClipIsUnknown = false;
      let webkitBackgroundClipIsUnknown = false;
      let fontSizePx: number | null = null;
      let isBold: boolean | null = null;

      for (const property of properties) {
        const key = getStylePropertyKey(property);
        if (!key) continue;
        if (key === "backgroundImage") {
          backgroundImageRaw = getStylePropertyStringValue(property);
          backgroundImageIsUnknown = backgroundImageRaw === null;
          continue;
        }
        if (key === "backgroundClip") {
          backgroundClipRaw = getStylePropertyStringValue(property);
          backgroundClipIsUnknown = backgroundClipRaw === null;
          continue;
        }
        if (key === "WebkitBackgroundClip") {
          webkitBackgroundClipRaw = getStylePropertyStringValue(property);
          webkitBackgroundClipIsUnknown = webkitBackgroundClipRaw === null;
          continue;
        }
        if (key === "fontSize" && property.type === "Property") {
          fontSizePx = toPx(property);
          continue;
        }
        if (key === "fontWeight" && property.type === "Property") {
          isBold = resolveBoldWeight(property);
          continue;
        }
        const stringValue = getStylePropertyStringValue(property);
        if (key === "color") {
          foreground = stringValue === null ? null : resolveOpaqueColor(stringValue);
        } else if (key === "backgroundColor") {
          backgroundColorRaw = stringValue;
          backgroundColorIsUnknown = stringValue === null;
        } else if (key === "background") {
          // A non-string `background` (a CSS var, a gradient bound to an
          // expression, etc.) can't be judged — treat the surface as unknown.
          backgroundShorthandRaw = stringValue;
          backgroundShorthandIsUnknown = stringValue === null;
        }
      }

      if (backgroundColorIsUnknown || backgroundShorthandIsUnknown || backgroundImageIsUnknown) {
        return;
      }
      // Both `backgroundColor` and the `background` shorthand on one element is
      // ambiguous about which actually paints behind the text — bail.
      if (backgroundColorRaw !== null && backgroundShorthandRaw !== null) return;

      if (!foreground) return;

      let backgrounds: ParsedRgb[] | null = null;
      const hasPaintedBackgroundImage =
        backgroundImageRaw !== null && backgroundImageRaw.trim().toLowerCase() !== "none";
      if (hasPaintedBackgroundImage && backgroundShorthandRaw !== null) return;
      const canEvaluateBackgroundShorthandGradient =
        backgroundShorthandRaw !== null && backgroundImageRaw === null;
      if (hasPaintedBackgroundImage || canEvaluateBackgroundShorthandGradient) {
        const gradientRaw = hasPaintedBackgroundImage ? backgroundImageRaw : backgroundShorthandRaw;
        backgrounds = gradientRaw === null ? null : parseOpaqueGradientStops(gradientRaw);
        if (hasPaintedBackgroundImage && !backgrounds) return;
        if (backgrounds) {
          const clipsBackgroundToText = [backgroundClipRaw, webkitBackgroundClipRaw].some(
            (value) =>
              value?.split(",").some((clipValue) => clipValue.trim().toLowerCase() === "text") ===
              true,
          );
          if (backgroundClipIsUnknown || webkitBackgroundClipIsUnknown || clipsBackgroundToText) {
            return;
          }
        }
      }
      if (!backgrounds) {
        const backgroundRaw = backgroundColorRaw ?? backgroundShorthandRaw;
        const background = backgroundRaw === null ? null : resolveOpaqueColor(backgroundRaw);
        if (!background) return;
        backgrounds = [background];
      }

      // When the font size isn't in the inline style it may be set via a
      // class (`text-5xl`) — i.e. the text could be "large". To avoid false
      // positives on large text (which only needs 3:1), fall back to the
      // lenient large-text threshold whenever the size is unknown; only
      // apply the stricter 4.5:1 when we can see the size is normal.
      const couldBeLargeText =
        fontSizePx === null ||
        fontSizePx >= LARGE_TEXT_MIN_PX ||
        (isBold !== false && fontSizePx >= LARGE_BOLD_TEXT_MIN_PX);
      const threshold = couldBeLargeText ? WCAG_CONTRAST_LARGE_MIN : WCAG_CONTRAST_NORMAL_MIN;
      const ratio = Math.min(
        ...backgrounds.map((background) => getWcagContrastRatio(foreground, background)),
      );
      if (ratio < threshold) {
        context.report({
          node,
          message: `Your users struggle to read this text: its contrast against the background is ${ratio.toFixed(2)}:1, below the ${threshold}:1 WCAG minimum, so darken or lighten one of the colors.`,
        });
      }
    },
  }),
});
