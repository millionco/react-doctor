import {
  FLEX_OR_GRID_DISPLAY_TOKENS,
  GENERIC_ICON_GRADIENT_MAX_SIZE_SPACING_UNITS,
  TAILWIND_DISPLAY_TOKENS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const GRADIENT_UTILITY_PATTERN =
  /^(?:bg-gradient-to-|bg-linear-(?:to-|\d|\[|\()|bg-(?:radial|conic)(?:-|$)|-bg-(?:linear|conic)-)/;
const BACKGROUND_IMAGE_PATTERN = /^(?:bg-none)$/;
const GRADIENT_STOP_PATTERN = /^(from|via|to)-([a-z]+)-/;
const WHOLE_ELEMENT_ROUNDING_PATTERN = /^rounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full|\[.+\]))?$/;
const SIZE_PATTERN = /^(h|size|w)-([\d.]+)$/;
const PURPLE_STOP_COLORS = new Set(["indigo", "purple", "violet"]);
const BLUE_STOP_COLORS = new Set(["blue", "cyan", "sky"]);
const GRADIENT_STOP_NAMES = ["from", "via", "to"];

const hasPurpleAndBlueStops = (tokens: string[]): boolean => {
  const effectiveColors = GRADIENT_STOP_NAMES.map((stopName) =>
    getEffectiveTailwindClassNameToken(tokens, (utility) => utility.startsWith(`${stopName}-`)),
  )
    .filter((utility): utility is string => utility !== null)
    .map((utility) => utility.match(GRADIENT_STOP_PATTERN)?.[2] ?? null)
    .filter((color): color is string => color !== null);
  return (
    effectiveColors.some((color) => PURPLE_STOP_COLORS.has(color)) &&
    effectiveColors.some((color) => BLUE_STOP_COLORS.has(color))
  );
};

const hasCompactSquareSize = (tokens: string[]): boolean => {
  const widthUtility = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    /^(?:size|w)-[\d.]+$/.test(utility),
  );
  const heightUtility = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    /^(?:h|size)-[\d.]+$/.test(utility),
  );
  const widthMatch = widthUtility?.match(SIZE_PATTERN);
  const heightMatch = heightUtility?.match(SIZE_PATTERN);
  const width = widthMatch ? Number.parseFloat(widthMatch[2]) : null;
  const height = heightMatch ? Number.parseFloat(heightMatch[2]) : null;
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
      const tokens = splitTailwindClassName(classNameValue);
      const backgroundImage = getEffectiveTailwindClassNameToken(
        tokens,
        (utility) =>
          BACKGROUND_IMAGE_PATTERN.test(utility) || GRADIENT_UTILITY_PATTERN.test(utility),
      );
      if (!backgroundImage || !GRADIENT_UTILITY_PATTERN.test(backgroundImage)) return;
      if (!hasPurpleAndBlueStops(tokens)) return;
      const rounding = getEffectiveTailwindClassNameToken(tokens, (utility) =>
        WHOLE_ELEMENT_ROUNDING_PATTERN.test(utility),
      );
      if (!rounding || rounding === "rounded-none") return;
      const display = getEffectiveTailwindClassNameToken(tokens, (utility) =>
        TAILWIND_DISPLAY_TOKENS.has(utility),
      );
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
