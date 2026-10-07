import { DECORATIVE_GRID_MIN_GRADIENT_LAYERS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasJsxSpreadThatMayProvideAttribute } from "../../utils/has-jsx-spread-that-may-provide-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { normalizeTailwindArbitraryUtilityValue } from "../../utils/normalize-tailwind-arbitrary-utility-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { isDataVisualizationContext } from "./utils/is-data-visualization-context.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";
import { splitCssTopLevel } from "./utils/split-css-top-level.js";

const TAILWIND_BACKGROUND_SHORTHAND_PROPERTY_PATTERN = /^\[background:[\s\S]+\]$/i;
const TAILWIND_BACKGROUND_PROPERTY_PATTERN = /^\[(?:background|background-image):[\s\S]+\]$/i;
const TAILWIND_BACKGROUND_SIZE_PROPERTY_PATTERN = /^\[background-size:[\s\S]+\]$/i;
const TAILWIND_BACKGROUND_IMAGE_PATTERN =
  /^(?:bg-none|bg-(?:conic|linear|radial)(?:-|$)|bg-\[(?!length:)[\s\S]+\])$/i;
const TAILWIND_BACKGROUND_SIZE_PATTERN = /^(?:bg-(?:auto|contain|cover)|bg-\[length:[\s\S]+\])$/i;

const getLinearGradientBodies = (value: string): string[] => {
  const gradientBodies: string[] = [];
  const gradientPattern = /(?:-(?:moz|ms|o|webkit)-)?linear-gradient\(/gi;
  for (const match of value.matchAll(gradientPattern)) {
    if (match.index === undefined) continue;
    const prefix = value.slice(0, match.index).toLowerCase();
    if (prefix.endsWith("repeating-") || /[\w-]$/.test(prefix)) continue;
    const bodyStartIndex = match.index + match[0].length;
    let parenthesisDepth = 1;
    for (let characterIndex = bodyStartIndex; characterIndex < value.length; characterIndex += 1) {
      const character = value[characterIndex];
      if (character === "(") parenthesisDepth += 1;
      if (character !== ")") continue;
      parenthesisDepth -= 1;
      if (parenthesisDepth !== 0) continue;
      gradientBodies.push(value.slice(bodyStartIndex, characterIndex));
      break;
    }
  }
  return gradientBodies;
};

const getHairlineGradientAxis = (gradientBody: string): string | null => {
  const normalizedBody = gradientBody.trim().toLowerCase();
  const hasLeadingHairline = /\b1(?:\.0+)?px\s*,\s*transparent\s+1(?:\.0+)?px\b/i.test(
    normalizedBody,
  );
  const hasInvertedHairline =
    /transparent\s+calc\(\s*100%\s*-\s*1(?:\.0+)?px\s*\)\s*,[\s\S]*\b1(?:\.0+)?px\b/i.test(
      normalizedBody,
    );
  if (!hasLeadingHairline && !hasInvertedHairline) return null;
  if (/^(?:to\s+(?:left|right)|(?:90|270)(?:\.0+)?deg)\s*,/i.test(normalizedBody)) {
    return "vertical";
  }
  if (/^(?:to\s+(?:top|bottom)|(?:0|180|360)(?:\.0+)?deg)\s*,/i.test(normalizedBody)) {
    return "horizontal";
  }
  if (/^(?:to\b|[-+.\d]+(?:deg|grad|rad|turn)\b|in\s)/i.test(normalizedBody)) return null;
  return "horizontal";
};

const getFixedPixelTileDimensionCount = (value: string, isShorthand: boolean): number => {
  const layers = splitCssTopLevel(value, ",");
  if (!layers) return 0;
  let maximumDimensionCount = 0;
  for (const layer of layers) {
    let sizeValue = layer.trim();
    if (isShorthand) {
      const shorthandParts = splitCssTopLevel(layer, "/");
      if (!shorthandParts || shorthandParts.length !== 2 || !shorthandParts[1]) continue;
      sizeValue = shorthandParts[1];
    }
    const sizeMatch = sizeValue.match(
      /^(\d+(?:\.\d+)?)px(?:\s+(\d+(?:\.\d+)?)px)?(?:\s+(?:no-repeat|repeat|round|space)){0,2}$/i,
    );
    if (!sizeMatch || Number.parseFloat(sizeMatch[1]) <= 0) continue;
    if (sizeMatch[2] && Number.parseFloat(sizeMatch[2]) <= 0) continue;
    maximumDimensionCount = Math.max(maximumDimensionCount, sizeMatch[2] ? 2 : 1);
  }
  return maximumDimensionCount;
};

const isDecorativeGridValue = (
  backgroundValue: string,
  backgroundSizeValue: string | null,
  shouldUseBackgroundShorthandSize: boolean,
  isBackgroundSizeShorthand: boolean,
): boolean => {
  const hairlineAxes = getLinearGradientBodies(backgroundValue)
    .map(getHairlineGradientAxis)
    .filter((axis): axis is string => axis !== null);
  if (hairlineAxes.length === 0) return false;
  const tileDimensionCount = Math.max(
    shouldUseBackgroundShorthandSize ? getFixedPixelTileDimensionCount(backgroundValue, true) : 0,
    backgroundSizeValue
      ? getFixedPixelTileDimensionCount(backgroundSizeValue, isBackgroundSizeShorthand)
      : 0,
  );
  if (hairlineAxes.length >= DECORATIVE_GRID_MIN_GRADIENT_LAYERS) {
    return (
      new Set(hairlineAxes).size >= DECORATIVE_GRID_MIN_GRADIENT_LAYERS && tileDimensionCount >= 1
    );
  }
  return tileDimensionCount >= 2;
};

const getTailwindBackgroundValue = (utility: string): string | null => {
  const propertyMatch = utility.match(/^\[([^:\]]+):([\s\S]+)\]$/);
  if (
    propertyMatch?.[1] &&
    propertyMatch[2] &&
    ["background", "background-image"].includes(propertyMatch[1].toLowerCase())
  ) {
    return normalizeTailwindArbitraryUtilityValue(propertyMatch[2]);
  }
  const backgroundMatch = utility.match(/^bg-\[(?:image:)?([\s\S]+)\]$/);
  if (backgroundMatch?.[1]) {
    return normalizeTailwindArbitraryUtilityValue(backgroundMatch[1]);
  }
  return null;
};

const getTailwindBackgroundSizeValue = (utility: string): string | null => {
  const propertyMatch = utility.match(/^\[background-size:([\s\S]+)\]$/i);
  if (propertyMatch?.[1]) {
    return normalizeTailwindArbitraryUtilityValue(propertyMatch[1]);
  }
  const sizeMatch = utility.match(/^bg-\[length:([\s\S]+)\]$/i);
  if (sizeMatch?.[1]) return normalizeTailwindArbitraryUtilityValue(sizeMatch[1]);
  return /^(?:bg-auto|bg-contain|bg-cover)$/i.test(utility) ? utility.slice(3) : null;
};

const isDecorativeTailwindGrid = (
  classNameValue: string,
  backgroundSizeOverride?: string,
): boolean => {
  const tokens = splitTailwindClassName(classNameValue);
  const backgroundResolution = resolveEffectiveTailwindClassNameToken(tokens, (utility) =>
    Boolean(
      TAILWIND_BACKGROUND_PROPERTY_PATTERN.test(utility) ||
      TAILWIND_BACKGROUND_IMAGE_PATTERN.test(utility),
    ),
  );
  const backgroundSizeResolution = resolveEffectiveTailwindClassNameToken(tokens, (utility) =>
    Boolean(
      TAILWIND_BACKGROUND_SHORTHAND_PROPERTY_PATTERN.test(utility) ||
      TAILWIND_BACKGROUND_SIZE_PROPERTY_PATTERN.test(utility) ||
      TAILWIND_BACKGROUND_SIZE_PATTERN.test(utility),
    ),
  );
  if (backgroundResolution.isAmbiguous || backgroundSizeResolution.isAmbiguous) return false;
  const backgroundUtility = backgroundResolution.utility;
  if (!backgroundUtility) return false;
  const backgroundValue = getTailwindBackgroundValue(backgroundUtility);
  if (!backgroundValue) return false;
  const backgroundSizeUtility = backgroundSizeResolution.utility;
  const hasExplicitBackgroundSize =
    backgroundSizeOverride !== undefined ||
    Boolean(
      backgroundSizeUtility &&
      !TAILWIND_BACKGROUND_SHORTHAND_PROPERTY_PATTERN.test(backgroundSizeUtility),
    );
  return isDecorativeGridValue(
    backgroundValue,
    backgroundSizeOverride ??
      (backgroundSizeUtility ? getTailwindBackgroundSizeValue(backgroundSizeUtility) : null),
    !hasExplicitBackgroundSize,
    false,
  );
};

export const noDecorativeGridBackground = defineRule({
  id: "no-decorative-grid-background",
  title: "Surface draws a decorative grid background",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Reserve coordinate grids for data or spatial interfaces; use a quieter surface for decoration.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (isDataVisualizationContext(node, context.filename)) return;
      let inlineBackgroundSizeValue: string | undefined;
      const styleAttribute = getAuthoritativeJsxAttribute(node.attributes ?? [], "style");
      if (!styleAttribute && hasJsxSpreadThatMayProvideAttribute(node.attributes ?? [], "style")) {
        return;
      }
      if (styleAttribute) {
        const styleExpression = getInlineStyleExpression(styleAttribute, context.scopes);
        if (!styleExpression) return;
        if (styleExpression.properties.some((property) => getStylePropertyKey(property) === null)) {
          return;
        }
        let backgroundProperty: EsTreeNodeOfType<"Property"> | null = null;
        let backgroundSizeProperty: EsTreeNodeOfType<"Property"> | null = null;
        for (const property of styleExpression.properties) {
          if (!isNodeOfType(property, "Property")) return;
          const propertyName = getStylePropertyKey(property);
          if (propertyName === "background") {
            backgroundProperty = property;
            backgroundSizeProperty = property;
          }
          if (propertyName === "backgroundImage") backgroundProperty = property;
          if (propertyName === "backgroundSize") backgroundSizeProperty = property;
        }
        if (backgroundProperty || backgroundSizeProperty) {
          const backgroundValue = backgroundProperty
            ? getStylePropertyStringValue(backgroundProperty)
            : null;
          const backgroundSizeValue = backgroundSizeProperty
            ? getStylePropertyStringValue(backgroundSizeProperty)
            : null;
          if (
            backgroundSizeProperty &&
            backgroundSizeProperty !== backgroundProperty &&
            backgroundSizeValue === null
          ) {
            return;
          }
          if (backgroundSizeProperty !== backgroundProperty && backgroundSizeValue) {
            inlineBackgroundSizeValue = backgroundSizeValue;
          }
          if (
            backgroundValue &&
            isDecorativeGridValue(
              backgroundValue,
              backgroundSizeValue,
              backgroundSizeProperty === backgroundProperty,
              Boolean(
                backgroundSizeProperty &&
                getStylePropertyKey(backgroundSizeProperty) === "background",
              ),
            )
          ) {
            context.report({
              node: backgroundProperty ?? styleAttribute,
              message:
                "This fixed-pixel background draws a decorative coordinate grid. Use it only when the grid conveys spatial information.",
            });
            return;
          }
          if (backgroundProperty) return;
        }
      }
      const classNameValue = getStringFromClassNameAttr(node);
      if (classNameValue && isDecorativeTailwindGrid(classNameValue, inlineBackgroundSizeValue)) {
        context.report({
          node,
          message:
            "This fixed-pixel grid is decorative rather than functional. Simplify the surface or tie the grid to spatial content.",
        });
      }
    },
  }),
});
