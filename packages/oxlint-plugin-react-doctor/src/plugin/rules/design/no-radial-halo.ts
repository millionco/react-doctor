import {
  DARK_BACKGROUND_CHANNEL_MAX,
  RADIAL_HALO_DARK_BACKGROUND_ALPHA_MIN,
  RADIAL_HALO_SMALL_EXTENT_MAX_PX,
  RADIAL_HALO_TRANSPARENT_ALPHA_MAX,
  RADIAL_HALO_VISIBLE_ALPHA_MIN,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { getStaticJsxTreeRoot } from "../../utils/get-static-jsx-tree-root.js";
import { hasJsxSpreadThatMayProvideAttribute } from "../../utils/has-jsx-spread-that-may-provide-attribute.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { normalizeTailwindArbitraryUtilityValue } from "../../utils/normalize-tailwind-arbitrary-utility-value.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveStylePropertyAmong } from "./utils/get-effective-style-property-among.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStaticTailwindBackgroundImage } from "./utils/get-static-tailwind-background-image.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { hasColorChroma } from "./utils/has-color-chroma.js";
import { isDataVisualizationContext } from "./utils/is-data-visualization-context.js";
import { parseStaticCssColorWithAlpha } from "./utils/parse-static-css-color-with-alpha.js";
import type { StaticCssGradientStop } from "./utils/parse-static-css-gradient-stop.js";
import { parseStaticRadialGradient } from "./utils/parse-static-radial-gradient.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";

interface StaticHaloElementEvidence {
  styleExpression: EsTreeNodeOfType<"ObjectExpression"> | null;
  tokens: string[];
}

interface TailwindBackgroundColorEvidence {
  isAmbiguous: boolean;
  isImportant: boolean;
  value: string | null;
}

const HALO_SURFACE_ELEMENT_NAMES = new Set([
  "article",
  "aside",
  "div",
  "header",
  "main",
  "section",
]);
const BACKGROUND_IMAGE_STYLE_PROPERTY_NAMES = new Set(["background", "backgroundImage"]);
const BACKGROUND_COLOR_STYLE_PROPERTY_NAMES = new Set(["background", "backgroundColor"]);
const TAILWIND_ARBITRARY_IMAGE_VALUE_PATTERN =
  /^(?:image:|(?:radial-gradient|repeating-radial-gradient|linear-gradient|repeating-linear-gradient|conic-gradient|repeating-conic-gradient|url)\()/i;
const TAILWIND_NON_COLOR_BACKGROUND_UTILITY_PATTERN =
  /^bg-(?:auto|bottom|center|clip-|contain|cover|fixed|left|local|no-repeat|none|origin-|repeat|right|scroll|top)/;

const isTailwindBackgroundColorUtility = (utility: string): boolean => {
  if (/^\[(?:background|background-color):[\s\S]+\]$/i.test(utility)) return true;
  if (utility.startsWith("bg-[") && utility.endsWith("]")) {
    const arbitraryValue = utility.slice(4, -1);
    return !TAILWIND_ARBITRARY_IMAGE_VALUE_PATTERN.test(arbitraryValue);
  }
  return utility.startsWith("bg-") && !TAILWIND_NON_COLOR_BACKGROUND_UTILITY_PATTERN.test(utility);
};

const getStaticTailwindBackgroundColor = (tokens: string[]): TailwindBackgroundColorEvidence => {
  const resolution = resolveEffectiveTailwindClassNameToken(
    tokens,
    isTailwindBackgroundColorUtility,
    [],
  );
  const utility = resolution.utility;
  if (!utility) {
    return {
      isAmbiguous: resolution.isAmbiguous,
      isImportant: resolution.isImportant,
      value: null,
    };
  }
  let arbitraryValue: string | null = null;
  if (utility.startsWith("bg-[") && utility.endsWith("]")) {
    arbitraryValue = utility.slice(4, -1).replace(/^color:/i, "");
  } else {
    const propertyMatch = utility.match(/^\[(?:background|background-color):([\s\S]+)\]$/i);
    arbitraryValue = propertyMatch?.[1] ?? null;
  }
  return {
    isAmbiguous: resolution.isAmbiguous,
    isImportant: resolution.isImportant,
    value: arbitraryValue ? normalizeTailwindArbitraryUtilityValue(arbitraryValue) : null,
  };
};

const getStaticHaloElementEvidence = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): StaticHaloElementEvidence | null => {
  if (!isProvenIntrinsicJsxElement(node, context.scopes)) return null;
  const classNameAttribute = getAuthoritativeJsxAttribute(node.attributes, "className");
  const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
  if (
    (!classNameAttribute && hasJsxSpreadThatMayProvideAttribute(node.attributes, "className")) ||
    (!styleAttribute && hasJsxSpreadThatMayProvideAttribute(node.attributes, "style"))
  ) {
    return null;
  }
  const className = classNameAttribute ? getStringFromClassNameAttr(node) : "";
  if (classNameAttribute && className === null) return null;
  const styleExpression = styleAttribute
    ? getInlineStyleExpression(styleAttribute, context.scopes)
    : null;
  if (
    (styleAttribute && !styleExpression) ||
    styleExpression?.properties.some((property) => getStylePropertyKey(property) === null)
  ) {
    return null;
  }
  return {
    styleExpression,
    tokens:
      className && hasCapabilityOrUnspecified(context.settings, "tailwind")
        ? splitTailwindClassName(className)
        : [],
  };
};

const hasDarkBackground = (evidence: StaticHaloElementEvidence): boolean => {
  const tailwindBackground = getStaticTailwindBackgroundColor(evidence.tokens);
  if (tailwindBackground.isAmbiguous) return false;
  const inlineBackgroundProperty = getEffectiveStylePropertyAmong(
    evidence.styleExpression?.properties,
    BACKGROUND_COLOR_STYLE_PROPERTY_NAMES,
  );
  const inlineBackgroundValue = inlineBackgroundProperty
    ? getStylePropertyStringValue(inlineBackgroundProperty)
    : null;
  const backgroundValue =
    inlineBackgroundProperty && !tailwindBackground.isImportant
      ? inlineBackgroundValue
      : tailwindBackground.value;
  if (!backgroundValue) return false;
  const color = parseStaticCssColorWithAlpha(backgroundValue);
  return Boolean(
    color &&
    color.alpha >= RADIAL_HALO_DARK_BACKGROUND_ALPHA_MIN &&
    color.red <= DARK_BACKGROUND_CHANNEL_MAX &&
    color.green <= DARK_BACKGROUND_CHANNEL_MAX &&
    color.blue <= DARK_BACKGROUND_CHANNEL_MAX,
  );
};

const getStaticBackgroundImage = (
  evidence: StaticHaloElementEvidence,
): {
  property: EsTreeNodeOfType<"Property"> | null;
  value: string | null;
} | null => {
  const tailwindBackground = getStaticTailwindBackgroundImage(evidence.tokens);
  if (tailwindBackground.isAmbiguous) return null;
  const inlineBackgroundProperty = getEffectiveStylePropertyAmong(
    evidence.styleExpression?.properties,
    BACKGROUND_IMAGE_STYLE_PROPERTY_NAMES,
  );
  const inlineBackgroundValue = inlineBackgroundProperty
    ? getStylePropertyStringValue(inlineBackgroundProperty)
    : null;
  return {
    property: inlineBackgroundProperty,
    value:
      inlineBackgroundProperty && !tailwindBackground.isImportant
        ? inlineBackgroundValue
        : tailwindBackground.value,
  };
};

const isSmallPixelHalo = (stops: StaticCssGradientStop[]): boolean => {
  const positions = stops.flatMap((stop) => stop.positions);
  if (positions.length === 0) return false;
  let maximumPixelExtent = 0;
  for (const position of positions) {
    const numericValue = Number.parseFloat(position);
    if (!Number.isFinite(numericValue)) return false;
    if (numericValue === 0) continue;
    if (!position.toLowerCase().endsWith("px")) return false;
    maximumPixelExtent = Math.max(maximumPixelExtent, Math.abs(numericValue));
  }
  return maximumPixelExtent <= RADIAL_HALO_SMALL_EXTENT_MAX_PX;
};

const hasSaturatedRadialHalo = (backgroundValue: string): boolean => {
  const stops = parseStaticRadialGradient(backgroundValue);
  if (!stops || isSmallPixelHalo(stops)) return false;
  const finalStop = stops.at(-1);
  if (!finalStop || finalStop.color.alpha > RADIAL_HALO_TRANSPARENT_ALPHA_MAX) {
    return false;
  }
  const firstVisibleStop = stops
    .slice(0, -1)
    .find((stop) => stop.color.alpha > RADIAL_HALO_TRANSPARENT_ALPHA_MAX);
  return Boolean(
    firstVisibleStop &&
    firstVisibleStop.color.alpha >= RADIAL_HALO_VISIBLE_ALPHA_MIN &&
    hasColorChroma(firstVisibleStop.color),
  );
};

const getStaticRootOpeningElement = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  const root = getStaticJsxTreeRoot(node);
  return isNodeOfType(root, "JSXElement") ? root.openingElement : null;
};

export const noRadialHalo = defineRule({
  id: "no-radial-halo",
  title: "Saturated radial halo on a dark surface",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  recommendation:
    "Use restrained surface contrast, product-specific imagery, or a subtler accent instead of a saturated radial halo on a dark page.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isNodeOfType(node.name, "JSXIdentifier") ||
        !HALO_SURFACE_ELEMENT_NAMES.has(node.name.name) ||
        isDataVisualizationContext(node, context.filename)
      ) {
        return;
      }
      const evidence = getStaticHaloElementEvidence(node, context);
      if (!evidence) return;
      const backgroundImage = getStaticBackgroundImage(evidence);
      if (!backgroundImage?.value || !hasSaturatedRadialHalo(backgroundImage.value)) {
        return;
      }
      const rootOpeningElement = getStaticRootOpeningElement(node);
      const rootEvidence =
        rootOpeningElement && rootOpeningElement !== node
          ? getStaticHaloElementEvidence(rootOpeningElement, context)
          : null;
      if (!hasDarkBackground(evidence) && (!rootEvidence || !hasDarkBackground(rootEvidence))) {
        return;
      }
      context.report({
        node: backgroundImage.property ?? node,
        message:
          "This saturated radial halo adds a generic glow to a dark surface. Replace it with a more specific visual treatment or simplify the background.",
      });
    },
  }),
});
