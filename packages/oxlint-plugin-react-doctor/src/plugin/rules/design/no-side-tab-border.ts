import {
  SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX,
  SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX,
  SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { hasColorChroma } from "./utils/has-color-chroma.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";

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

const ARBITRARY_BORDER_COLOR_PATTERN = /^border(?:-([lrsetb]))?-\[([^\]]+)\](?:\/.+)?$/;
const NAMED_BORDER_COLOR_PATTERN =
  /^border(?:-([lrsetb]))?-((?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+|white|black|transparent)(?:\/.+)?$/;
const NEUTRAL_NAMED_BORDER_COLOR_PATTERN =
  /^(?:(?:gray|slate|zinc|neutral|stone)-\d+|white|black|transparent)$/;
const SIDE_BORDER_WIDTH_PATTERN = /^border-([lrsetb])-(\d+)$/;
const ROUNDING_PATTERN = /^rounded(?:-|$)/;
const BORDER_SIDE_LETTER_BY_KEY = new Map([
  ["borderLeft", "l"],
  ["borderRight", "r"],
  ["borderTop", "t"],
  ["borderBottom", "b"],
  ["borderInlineStart", "s"],
  ["borderInlineEnd", "e"],
]);
const INLINE_BORDER_WIDTH_KEYS_BY_SIDE = new Map([
  ["l", ["borderLeft", "borderLeftWidth"]],
  ["r", ["borderRight", "borderRightWidth"]],
  ["t", ["borderTop", "borderTopWidth"]],
  ["b", ["borderBottom", "borderBottomWidth"]],
  ["s", ["borderInlineStart", "borderInlineStartWidth"]],
  ["e", ["borderInlineEnd", "borderInlineEndWidth"]],
]);

const getTailwindSideWidthResolution = (tokens: string[], sideLetter: string) => {
  const sideWidthPattern = new RegExp(`^border-${sideLetter}-(\\d+)$`);
  return resolveEffectiveTailwindClassNameToken(tokens, (utility) =>
    sideWidthPattern.test(utility),
  );
};

const hasInlineSideWidthDeclaration = (
  properties: ReadonlyArray<EsTreeNode>,
  sideLetter: string,
): boolean =>
  (INLINE_BORDER_WIDTH_KEYS_BY_SIDE.get(sideLetter) ?? []).some((propertyName) =>
    Boolean(getEffectiveStyleProperty(properties, propertyName)),
  );

const hasSpinnerClass = (className: string): boolean => {
  const utilities = splitTailwindClassName(className).map(
    (classNameToken) => parseTailwindClassNameToken(classNameToken).utility,
  );
  return (
    utilities.includes("spinner") ||
    (utilities.includes("animate-spin") && utilities.includes("rounded-full"))
  );
};

const isTailwindBorderColorUtilityForSide = (utility: string, expectedSide: string): boolean => {
  const namedColorMatch = utility.match(NAMED_BORDER_COLOR_PATTERN);
  if (namedColorMatch) return (namedColorMatch[1] ?? "") === expectedSide;
  const arbitraryColorMatch = utility.match(ARBITRARY_BORDER_COLOR_PATTERN);
  return Boolean(arbitraryColorMatch && (arbitraryColorMatch[1] ?? "") === expectedSide);
};

const getTailwindBorderColorNeutrality = (
  utility: string,
  expectedSide: string,
): boolean | null => {
  const namedColorMatch = utility.match(NAMED_BORDER_COLOR_PATTERN);
  if (namedColorMatch && (namedColorMatch[1] ?? "") === expectedSide) {
    return NEUTRAL_NAMED_BORDER_COLOR_PATTERN.test(namedColorMatch[2]);
  }
  const arbitraryColorMatch = utility.match(ARBITRARY_BORDER_COLOR_PATTERN);
  if (!arbitraryColorMatch || (arbitraryColorMatch[1] ?? "") !== expectedSide) return null;
  const parsedColor = parseColorToRgb(arbitraryColorMatch[2]);
  return parsedColor ? !hasColorChroma(parsedColor) : null;
};

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
      const classNameTokens = className ? splitTailwindClassName(className) : [];

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
        const sideLetter = BORDER_SIDE_LETTER_BY_KEY.get(key);
        const tailwindSideWidthResolution = sideLetter
          ? getTailwindSideWidthResolution(classNameTokens, sideLetter)
          : null;
        if (tailwindSideWidthResolution?.isImportant || tailwindSideWidthResolution?.isAmbiguous) {
          continue;
        }
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
        const sideLetter = BORDER_SIDE_LETTER_BY_KEY.get(key.replace("Width", ""));
        const tailwindSideWidthResolution = sideLetter
          ? getTailwindSideWidthResolution(classNameTokens, sideLetter)
          : null;
        if (tailwindSideWidthResolution?.isImportant || tailwindSideWidthResolution?.isAmbiguous) {
          continue;
        }
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
      if (!hasCapabilityOrUnspecified(context.settings, "tailwind")) return;
      const classStr = getStringFromClassNameAttr(node);
      if (!classStr) return;
      if (hasSpinnerClass(classStr)) return;

      const classNameTokens = splitTailwindClassName(classStr);
      const hasBaseRoundingUtility = classNameTokens.some((classNameToken) => {
        const parsedToken = parseTailwindClassNameToken(classNameToken);
        return parsedToken.variants.length === 0 && ROUNDING_PATTERN.test(parsedToken.utility);
      });
      const effectiveRounding = getEffectiveTailwindClassNameToken(classNameTokens, (utility) =>
        ROUNDING_PATTERN.test(utility),
      );
      if (hasBaseRoundingUtility && effectiveRounding === null) return;
      const hasRounded = effectiveRounding !== null && !effectiveRounding.endsWith("none");
      const tailwindThreshold = hasRounded
        ? SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX
        : SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS;
      const qualifyingSideMatchesBySide = new Map<string, RegExpMatchArray>();
      for (const sideLetter of ["l", "r", "s", "e", "t", "b"]) {
        const sideWidthPattern = new RegExp(`^border-${sideLetter}-(\\d+)$`);
        const hasBaseSideWidthUtility = classNameTokens.some((classNameToken) => {
          const parsedToken = parseTailwindClassNameToken(classNameToken);
          return parsedToken.variants.length === 0 && sideWidthPattern.test(parsedToken.utility);
        });
        const effectiveSideWidth = getEffectiveTailwindClassNameToken(classNameTokens, (utility) =>
          sideWidthPattern.test(utility),
        );
        if (hasBaseSideWidthUtility && effectiveSideWidth === null) return;
        const sideMatch = effectiveSideWidth?.match(SIDE_BORDER_WIDTH_PATTERN);
        if (!sideMatch) continue;
        const matchedSideLetter = sideMatch[1];
        const width = parseInt(sideMatch[2], 10);
        if (
          width >= tailwindThreshold &&
          (hasRounded || (matchedSideLetter !== "t" && matchedSideLetter !== "b"))
        ) {
          qualifyingSideMatchesBySide.set(matchedSideLetter, sideMatch);
        }
      }
      if (qualifyingSideMatchesBySide.size !== 1) return;
      const [sideMatch] = qualifyingSideMatchesBySide.values();
      if (!sideMatch) return;
      const flaggedSideLetter = sideMatch[1];
      const flaggedWidthResolution = getTailwindSideWidthResolution(
        classNameTokens,
        flaggedSideLetter,
      );
      const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
      const styleExpression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
      if (styleAttribute && !styleExpression) return;
      if (
        !flaggedWidthResolution.isImportant &&
        styleExpression &&
        hasInlineSideWidthDeclaration(styleExpression.properties, flaggedSideLetter)
      ) {
        return;
      }

      const baseColorTokens = classNameTokens.filter((classNameToken) => {
        const parsedToken = parseTailwindClassNameToken(classNameToken);
        return (
          parsedToken.variants.length === 0 &&
          isTailwindBorderColorUtilityForSide(parsedToken.utility, "")
        );
      });
      const sideColorTokens = classNameTokens.filter((classNameToken) => {
        const parsedToken = parseTailwindClassNameToken(classNameToken);
        return (
          parsedToken.variants.length === 0 &&
          isTailwindBorderColorUtilityForSide(parsedToken.utility, flaggedSideLetter)
        );
      });
      const effectiveBaseColor = getEffectiveTailwindClassNameToken(baseColorTokens, () => true);
      const effectiveSideColor = getEffectiveTailwindClassNameToken(sideColorTokens, () => true);
      const hasImportantBaseColor = baseColorTokens.some(
        (classNameToken) => parseTailwindClassNameToken(classNameToken).isImportant,
      );
      const hasImportantSideColor = sideColorTokens.some(
        (classNameToken) => parseTailwindClassNameToken(classNameToken).isImportant,
      );
      let decidingBorderColor: string | null = null;
      let decidingBorderColorSide = "";
      if (hasImportantSideColor || (sideColorTokens.length > 0 && !hasImportantBaseColor)) {
        if (effectiveSideColor === null) return;
        decidingBorderColor = effectiveSideColor;
        decidingBorderColorSide = flaggedSideLetter;
      } else if (baseColorTokens.length > 0) {
        if (effectiveBaseColor === null) return;
        decidingBorderColor = effectiveBaseColor;
      }
      if (
        decidingBorderColor !== null &&
        getTailwindBorderColorNeutrality(decidingBorderColor, decidingBorderColorSide) !== false
      ) {
        return;
      }

      context.report({
        node,
        message: `Your users see an off, dated thick border on one side (${sideMatch[0]}), so use a softer accent or drop it.`,
      });
    },
  }),
});
