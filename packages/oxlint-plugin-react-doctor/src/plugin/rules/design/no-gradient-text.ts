import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getEffectiveStylePropertyAmong } from "./utils/get-effective-style-property-among.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { getTailwindTopLevelCharacterIndices } from "../../utils/get-tailwind-top-level-character-indices.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasJsxSpreadThatMayProvideAttribute } from "../../utils/has-jsx-spread-that-may-provide-attribute.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";

const TAILWIND_GRADIENT_BACKGROUND_PATTERN =
  /^(?:bg-gradient-to-(?:[tb][rl]|[trbl])|bg-linear-(?:\d+|to-(?:[tb][rl]|[trbl])|\[[\s\S]+\]|\([\s\S]+\))|-bg-linear-(?:\d+|\[[\s\S]+\])|bg-radial(?:-\[[\s\S]+\]|-\([\s\S]+\))?|-?bg-conic(?:-\d+|-\[[\s\S]+\]|-\([\s\S]+\))?)$/;
const TAILWIND_ARBITRARY_GRADIENT_BACKGROUND_PATTERN =
  /^bg-\[(?:repeating-)?(?:linear|radial|conic)-gradient\([\s\S]+\)\]$/i;
const TAILWIND_ARBITRARY_BACKGROUND_IMAGE_PATTERN =
  /^bg-(?:\(image:--[\w-]+\)|\[(?:image:|(?:url|image-set|cross-fade|element)\()[\s\S]+\])$/i;
const CSS_GRADIENT_FUNCTION_PATTERN = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;
const BACKGROUND_STYLE_PROPERTY_NAMES = new Set(["background", "backgroundImage"]);
const TRANSPARENT_COLOR_PATTERN =
  /^(?:transparent|#[\da-f]{3}0|#[\da-f]{6}00|(?:rgb|hsl)a?\([^)]*[,/]\s*[+-]?0(?:\.0+)?%?\s*\)|(?:hwb|lab|lch|oklab|oklch|color)\([^)]*\/\s*[+-]?0(?:\.0+)?%?\s*\))$/i;
const TAILWIND_NON_COLOR_TEXT_UTILITY_PATTERN =
  /^text-(?:left|right|center|justify|start|end|wrap|nowrap|balance|pretty|ellipsis|clip|xs|sm|base|lg|xl|[2-9]xl)$/;
const TAILWIND_ARBITRARY_FONT_SIZE_PATTERN =
  /^text-(?:\[(?:(?:length|percentage|absolute-size|relative-size):|(?:calc|min|max|clamp)\(|-?(?:\d*\.)?\d+(?:%|[a-z]+)\])|\((?:length|percentage|absolute-size|relative-size):)/i;

const getTailwindUtilityWithoutModifier = (utility: string): string => {
  const modifierIndex = getTailwindTopLevelCharacterIndices(
    utility,
    (character) => character === "/",
  )[0];
  return modifierIndex === undefined ? utility : utility.slice(0, modifierIndex);
};

const isTailwindGradientBackgroundUtility = (utility: string): boolean => {
  const utilityWithoutModifier = getTailwindUtilityWithoutModifier(utility);
  return (
    TAILWIND_GRADIENT_BACKGROUND_PATTERN.test(utilityWithoutModifier) ||
    (utility === utilityWithoutModifier &&
      TAILWIND_ARBITRARY_GRADIENT_BACKGROUND_PATTERN.test(utilityWithoutModifier))
  );
};

const isTailwindBackgroundImageUtility = (utility: string): boolean => {
  const utilityWithoutModifier = getTailwindUtilityWithoutModifier(utility);
  return (
    utility === "bg-none" ||
    isTailwindGradientBackgroundUtility(utility) ||
    (utility === utilityWithoutModifier &&
      TAILWIND_ARBITRARY_BACKGROUND_IMAGE_PATTERN.test(utilityWithoutModifier))
  );
};

const hasCssGradientFunction = (value: string): boolean =>
  getTailwindTopLevelCharacterIndices(value, (character) => /[lrc]/i.test(character)).some(
    (characterIndex) => CSS_GRADIENT_FUNCTION_PATTERN.test(value.slice(characterIndex)),
  );

const isTailwindTextColorUtility = (utility: string): boolean => {
  const utilityWithoutModifier = getTailwindUtilityWithoutModifier(utility);
  if (!utilityWithoutModifier.startsWith("text-")) return false;
  if (
    utilityWithoutModifier === "text-shadow" ||
    utilityWithoutModifier.startsWith("text-shadow-") ||
    utilityWithoutModifier.startsWith("text-opacity-") ||
    utilityWithoutModifier === "text-box" ||
    utilityWithoutModifier.startsWith("text-box-")
  ) {
    return false;
  }
  return (
    !TAILWIND_NON_COLOR_TEXT_UTILITY_PATTERN.test(utilityWithoutModifier) &&
    !TAILWIND_ARBITRARY_FONT_SIZE_PATTERN.test(utilityWithoutModifier)
  );
};

export const noGradientText = defineRule({
  id: "no-gradient-text",
  title: "Gradient text is hard to read",
  tags: ["design", "test-noise"],
  severity: "warn",
  // Default off: subjective design / house-style preference, not a
  // correctness, performance, or accessibility issue. Opt in to enforce it.
  defaultEnabled: false,
  recommendation:
    "Use a solid text color so it stays readable. For emphasis, change the weight, size, or color instead of using a gradient.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isProvenIntrinsicJsxElement(node, context.scopes)) return;
      const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
      if (!styleAttribute && hasJsxSpreadThatMayProvideAttribute(node.attributes, "style")) return;
      const styleExpression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
      if (styleAttribute && !styleExpression) return;
      if (styleExpression?.properties.some((property) => !getStylePropertyKey(property))) return;

      const backgroundProperty = getEffectiveStylePropertyAmong(
        styleExpression?.properties,
        BACKGROUND_STYLE_PROPERTY_NAMES,
      );
      const backgroundValue = backgroundProperty
        ? getStylePropertyStringValue(backgroundProperty)
        : null;
      const backgroundClipProperty =
        getEffectiveStyleProperty(styleExpression?.properties, "WebkitBackgroundClip") ??
        getEffectiveStyleProperty(styleExpression?.properties, "backgroundClip");
      const backgroundClipValue = backgroundClipProperty
        ? getStylePropertyStringValue(backgroundClipProperty)
        : null;
      const textFillProperty =
        getEffectiveStyleProperty(styleExpression?.properties, "WebkitTextFillColor") ??
        getEffectiveStyleProperty(styleExpression?.properties, "color");
      const textFillValue = textFillProperty ? getStylePropertyStringValue(textFillProperty) : null;
      if (
        (backgroundProperty && backgroundValue === null) ||
        (backgroundClipProperty && backgroundClipValue === null) ||
        (textFillProperty && textFillValue === null)
      ) {
        return;
      }

      const classStr = getStringFromClassNameAttr(node);
      const rawTokens =
        classStr && hasCapabilityOrUnspecified(context.settings, "tailwind")
          ? splitTailwindClassName(classStr)
          : [];
      const targetVariantScopes = new Map<string, string[]>([["", []]]);
      for (const rawToken of rawTokens) {
        const parsedToken = parseTailwindClassNameToken(rawToken);
        const variantScope = parsedToken.variants.join(":");
        targetVariantScopes.set(variantScope, parsedToken.variants);
      }

      const hasGradientText = [...targetVariantScopes.values()].some((targetVariantScope) => {
        const backgroundResolution = resolveEffectiveTailwindClassNameToken(
          rawTokens,
          isTailwindBackgroundImageUtility,
          targetVariantScope,
        );
        const backgroundClipResolution = resolveEffectiveTailwindClassNameToken(
          rawTokens,
          (utility) => utility.startsWith("bg-clip-"),
          targetVariantScope,
        );
        const textColorResolution = resolveEffectiveTailwindClassNameToken(
          rawTokens,
          isTailwindTextColorUtility,
          targetVariantScope,
        );
        const hasGradientBackground =
          backgroundProperty && !backgroundResolution.isImportant
            ? Boolean(backgroundValue && hasCssGradientFunction(backgroundValue))
            : Boolean(
                backgroundResolution.utility &&
                isTailwindGradientBackgroundUtility(backgroundResolution.utility),
              );
        const hasTextBackgroundClip =
          backgroundClipProperty && !backgroundClipResolution.isImportant
            ? backgroundClipValue?.toLowerCase() === "text"
            : backgroundClipResolution.utility === "bg-clip-text";
        const hasTransparentTextFill =
          textFillProperty && !textColorResolution.isImportant
            ? Boolean(textFillValue && TRANSPARENT_COLOR_PATTERN.test(textFillValue.trim()))
            : Boolean(
                textColorResolution.utility &&
                getTailwindUtilityWithoutModifier(textColorResolution.utility) ===
                  "text-transparent",
              );
        return hasGradientBackground && hasTextBackgroundClip && hasTransparentTextFill;
      });
      if (hasGradientText) {
        context.report({
          node,
          message:
            "Your users struggle to read gradient-filled text, so use a solid text color instead.",
        });
      }
    },
  }),
});
