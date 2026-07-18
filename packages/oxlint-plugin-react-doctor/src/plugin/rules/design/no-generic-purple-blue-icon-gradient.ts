import {
  FLEX_OR_GRID_DISPLAY_TOKENS,
  GENERIC_ICON_GRADIENT_MAX_SIZE_SPACING_UNITS,
  TAILWIND_DISPLAY_TOKENS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getLastMatchingToken } from "./utils/get-last-matching-token.js";

const BACKGROUND_IMAGE_PATTERN = /^(?:bg-(?:gradient|linear)-to-|bg-none$)/;
const GRADIENT_UTILITY_PATTERN = /^bg-(?:gradient|linear)-to-/;
const GRADIENT_STOP_PATTERN = /^(from|via|to)-([a-z]+)-/;
const WHOLE_ELEMENT_ROUNDING_PATTERN = /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[.+\]))?$/;
const SIZE_PATTERN = /^(h|size|w)-([\d.]+)$/;
const PURPLE_STOP_COLORS = new Set(["indigo", "purple", "violet"]);
const BLUE_STOP_COLORS = new Set(["blue", "cyan", "sky"]);

const hasPurpleAndBlueStops = (tokens: string[]): boolean => {
  const stopColors = new Map<string, string>();
  for (const token of tokens) {
    const stopMatch = token.match(GRADIENT_STOP_PATTERN);
    if (stopMatch) stopColors.set(stopMatch[1], stopMatch[2]);
  }
  const effectiveColors = [...stopColors.values()];
  return (
    effectiveColors.some((color) => PURPLE_STOP_COLORS.has(color)) &&
    effectiveColors.some((color) => BLUE_STOP_COLORS.has(color))
  );
};

const hasCompactSquareSize = (tokens: string[]): boolean => {
  let width: number | null = null;
  let height: number | null = null;
  for (const token of tokens) {
    const sizeMatch = token.match(SIZE_PATTERN);
    if (!sizeMatch) continue;
    const sizeValue = Number.parseFloat(sizeMatch[2]);
    if (sizeMatch[1] === "size" || sizeMatch[1] === "w") width = sizeValue;
    if (sizeMatch[1] === "size" || sizeMatch[1] === "h") height = sizeValue;
  }
  return Boolean(
    width !== null &&
    height !== null &&
    width === height &&
    width <= GENERIC_ICON_GRADIENT_MAX_SIZE_SPACING_UNITS,
  );
};

export const noGenericPurpleBlueIconGradient = defineRule({
  id: "no-generic-purple-blue-icon-gradient",
  title: "Compact icon tile uses a generic purple-to-blue gradient",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  requires: ["tailwind"],
  recommendation:
    "Use a product color, neutral surface, or unboxed icon instead of a generic purple-to-blue gradient tile.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isProvenIntrinsicJsxElement(node, context.scopes) ||
        hasJsxSpreadAttribute(node.attributes)
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      const backgroundImage = getLastMatchingToken(tokens, (token) =>
        BACKGROUND_IMAGE_PATTERN.test(token),
      );
      if (!backgroundImage || !GRADIENT_UTILITY_PATTERN.test(backgroundImage)) return;
      if (!hasPurpleAndBlueStops(tokens)) return;
      const rounding = getLastMatchingToken(tokens, (token) =>
        WHOLE_ELEMENT_ROUNDING_PATTERN.test(token),
      );
      if (!rounding || rounding === "rounded-none") return;
      const display = getLastMatchingToken(tokens, (token) => TAILWIND_DISPLAY_TOKENS.has(token));
      if (!display || !FLEX_OR_GRID_DISPLAY_TOKENS.has(display)) return;
      if (!hasCompactSquareSize(tokens)) return;
      context.report({
        node,
        message:
          "This compact purple-to-blue gradient tile is a common generated icon treatment. Use a visual tied to the product instead.",
      });
    },
  }),
});
