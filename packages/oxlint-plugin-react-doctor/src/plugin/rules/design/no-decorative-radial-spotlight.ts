import {
  DECORATIVE_RADIAL_SPOTLIGHT_MAX_VISIBLE_STOPS,
  DECORATIVE_RADIAL_SPOTLIGHT_MIN_HEIGHT_PX,
  DECORATIVE_RADIAL_SPOTLIGHT_MIN_WIDTH_PX,
  DECORATIVE_RADIAL_SPOTLIGHT_TRANSPARENT_ALPHA_MAX,
  DECORATIVE_RADIAL_SPOTLIGHT_VISIBLE_ALPHA_MAX,
  ROOT_FONT_SIZE_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { hasJsxSpreadThatMayProvideAttribute } from "../../utils/has-jsx-spread-that-may-provide-attribute.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveStylePropertyAmong } from "./utils/get-effective-style-property-among.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStaticTailwindBackgroundImage } from "./utils/get-static-tailwind-background-image.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { hasColorChroma } from "./utils/has-color-chroma.js";
import { isDataVisualizationContext } from "./utils/is-data-visualization-context.js";
import type { StaticCssColorWithAlpha } from "./utils/parse-static-css-color-with-alpha.js";
import { parseStaticRadialGradient } from "./utils/parse-static-radial-gradient.js";
import { parseStaticTailwindLengthPx } from "./utils/parse-static-tailwind-length-px.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";

interface TailwindSurfaceEvidence {
  heightPx: number | null;
  heightIsAmbiguous: boolean;
  heightIsImportant: boolean;
  hasHeight: boolean;
  hasWidth: boolean;
  insetBottom: TailwindZeroValueEvidence;
  insetLeft: TailwindZeroValueEvidence;
  insetRight: TailwindZeroValueEvidence;
  insetTop: TailwindZeroValueEvidence;
  positionIsAmbiguous: boolean;
  positionIsFixed: boolean | null;
  positionIsImportant: boolean;
  widthPx: number | null;
  widthIsAmbiguous: boolean;
  widthIsImportant: boolean;
}

interface TailwindZeroValueEvidence {
  isAmbiguous: boolean;
  isImportant: boolean;
  isZero: boolean | null;
}

const SPOTLIGHT_SURFACE_ELEMENT_NAMES = new Set([
  "article",
  "aside",
  "div",
  "header",
  "main",
  "section",
]);
const CSS_STATIC_LENGTH_PATTERN = /^(\d+(?:\.\d*)?|\.\d+)(px|rem)$/i;
const TAILWIND_WIDTH_UTILITY_PATTERN = /^(?:size|w)-/;
const TAILWIND_HEIGHT_UTILITY_PATTERN = /^(?:h|size)-/;
const BACKGROUND_STYLE_PROPERTY_NAMES = new Set(["background", "backgroundImage"]);
const INLINE_BOTTOM_PROPERTY_NAMES = new Set(["bottom", "inset"]);
const INLINE_LEFT_PROPERTY_NAMES = new Set(["inset", "left"]);
const INLINE_RIGHT_PROPERTY_NAMES = new Set(["inset", "right"]);
const INLINE_TOP_PROPERTY_NAMES = new Set(["inset", "top"]);

const hasDecorativeRadialSpotlightGradient = (backgroundValue: string): boolean => {
  const parsedStops = parseStaticRadialGradient(backgroundValue);
  if (!parsedStops) return false;
  const finalStop = parsedStops.at(-1)?.color;
  if (!finalStop || finalStop.alpha > DECORATIVE_RADIAL_SPOTLIGHT_TRANSPARENT_ALPHA_MAX) {
    return false;
  }
  const visibleStops = parsedStops
    .slice(0, -1)
    .map((stop) => stop.color)
    .filter(
      (stop): stop is StaticCssColorWithAlpha =>
        stop.alpha > DECORATIVE_RADIAL_SPOTLIGHT_TRANSPARENT_ALPHA_MAX,
    );
  if (
    visibleStops.length === 0 ||
    visibleStops.length > DECORATIVE_RADIAL_SPOTLIGHT_MAX_VISIBLE_STOPS ||
    visibleStops.some(
      (stop) =>
        stop.alpha >= DECORATIVE_RADIAL_SPOTLIGHT_VISIBLE_ALPHA_MAX || !hasColorChroma(stop),
    )
  ) {
    return false;
  }
  const firstVisibleStop = visibleStops[0];
  return visibleStops.every(
    (stop) =>
      stop.red === firstVisibleStop.red &&
      stop.green === firstVisibleStop.green &&
      stop.blue === firstVisibleStop.blue,
  );
};

const parseStaticLengthPx = (value: number | string | null): number | null => {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  if (typeof value !== "string") return null;
  const match = value.trim().match(CSS_STATIC_LENGTH_PATTERN);
  if (!match) return null;
  const numericValue = Number.parseFloat(match[1]);
  return match[2].toLowerCase() === "rem" ? numericValue * ROOT_FONT_SIZE_PX : numericValue;
};

const parseStaticZero = (value: number | string | null): boolean | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value === 0 : null;
  if (typeof value !== "string") return null;
  return /^[+-]?(?:0+(?:\.0*)?|\.0+)(?:px|rem)?$/i.test(value.trim());
};

const getTailwindInsetEdgeEvidence = (
  tokens: string[],
  edge: "bottom" | "left" | "right" | "top",
): TailwindZeroValueEvidence => {
  const axis = edge === "top" || edge === "bottom" ? "y" : "x";
  const resolution = resolveEffectiveTailwindClassNameToken(
    tokens,
    (utility) => {
      const unsignedUtility = utility.startsWith("-") ? utility.slice(1) : utility;
      return (
        /^inset-(?![xy]-)/.test(unsignedUtility) ||
        unsignedUtility.startsWith(`inset-${axis}-`) ||
        unsignedUtility.startsWith(`${edge}-`) ||
        ((edge === "left" || edge === "right") &&
          (unsignedUtility.startsWith("start-") || unsignedUtility.startsWith("end-")))
      );
    },
    [],
  );
  const utility = resolution.utility;
  const utilityPrefix = utility?.slice(0, utility.lastIndexOf("-")) ?? null;
  const unsignedUtility = utility?.startsWith("-") ? utility.slice(1) : utility;
  const isLogicalInset =
    unsignedUtility?.startsWith("start-") || unsignedUtility?.startsWith("end-");
  return {
    isAmbiguous: resolution.isAmbiguous,
    isImportant: resolution.isImportant,
    isZero:
      utility && utilityPrefix && !isLogicalInset
        ? parseStaticTailwindLengthPx(utility, utilityPrefix) === 0
        : utility === null
          ? null
          : false,
  };
};

const getTailwindSurfaceEvidence = (tokens: string[]): TailwindSurfaceEvidence => {
  const widthResolution = resolveEffectiveTailwindClassNameToken(
    tokens,
    (utility) => TAILWIND_WIDTH_UTILITY_PATTERN.test(utility),
    [],
  );
  const heightResolution = resolveEffectiveTailwindClassNameToken(
    tokens,
    (utility) => TAILWIND_HEIGHT_UTILITY_PATTERN.test(utility),
    [],
  );
  const positionResolution = resolveEffectiveTailwindClassNameToken(
    tokens,
    (utility) =>
      utility === "absolute" ||
      utility === "fixed" ||
      utility === "relative" ||
      utility === "static" ||
      utility === "sticky",
    [],
  );
  const widthPx = widthResolution.utility
    ? (parseStaticTailwindLengthPx(widthResolution.utility, "size") ??
      parseStaticTailwindLengthPx(widthResolution.utility, "w"))
    : null;
  const heightPx = heightResolution.utility
    ? (parseStaticTailwindLengthPx(heightResolution.utility, "size") ??
      parseStaticTailwindLengthPx(heightResolution.utility, "h"))
    : null;
  return {
    heightPx,
    heightIsAmbiguous: heightResolution.isAmbiguous,
    heightIsImportant: heightResolution.isImportant,
    hasHeight: heightResolution.utility !== null || heightResolution.isAmbiguous,
    hasWidth: widthResolution.utility !== null || widthResolution.isAmbiguous,
    insetBottom: getTailwindInsetEdgeEvidence(tokens, "bottom"),
    insetLeft: getTailwindInsetEdgeEvidence(tokens, "left"),
    insetRight: getTailwindInsetEdgeEvidence(tokens, "right"),
    insetTop: getTailwindInsetEdgeEvidence(tokens, "top"),
    positionIsAmbiguous: positionResolution.isAmbiguous,
    positionIsFixed: positionResolution.isAmbiguous
      ? null
      : positionResolution.utility === null
        ? null
        : positionResolution.utility === "fixed",
    positionIsImportant: positionResolution.isImportant,
    widthPx,
    widthIsAmbiguous: widthResolution.isAmbiguous,
    widthIsImportant: widthResolution.isImportant,
  };
};

const getEffectiveInsetEdgeIsZero = (
  styleProperties: ReadonlyArray<EsTreeNode> | undefined,
  propertyNames: ReadonlySet<string>,
  tailwindEvidence: TailwindZeroValueEvidence,
): boolean | null => {
  if (tailwindEvidence.isAmbiguous) return null;
  const inlineProperty = getEffectiveStylePropertyAmong(styleProperties, propertyNames);
  if (tailwindEvidence.isImportant) return tailwindEvidence.isZero;
  if (!inlineProperty) return tailwindEvidence.isZero;
  return parseStaticZero(
    getStylePropertyNumberValue(inlineProperty) ?? getStylePropertyStringValue(inlineProperty),
  );
};

export const noDecorativeRadialSpotlight = defineRule({
  id: "no-decorative-radial-spotlight",
  title: "Large decorative radial spotlight",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  recommendation:
    "Use product-specific imagery, structure, or a restrained solid surface instead of a large translucent radial glow.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (
        !isProvenIntrinsicJsxElement(node, context.scopes) ||
        !isNodeOfType(node.name, "JSXIdentifier") ||
        !SPOTLIGHT_SURFACE_ELEMENT_NAMES.has(node.name.name) ||
        isDataVisualizationContext(node, context.filename)
      ) {
        return;
      }
      const classNameAttribute = getAuthoritativeJsxAttribute(node.attributes, "className");
      const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
      if (
        (!classNameAttribute &&
          hasJsxSpreadThatMayProvideAttribute(node.attributes, "className")) ||
        (!styleAttribute && hasJsxSpreadThatMayProvideAttribute(node.attributes, "style"))
      ) {
        return;
      }
      const className = classNameAttribute ? getStringFromClassNameAttr(node) : "";
      if (classNameAttribute && className === null) return;
      const styleExpression = styleAttribute
        ? getInlineStyleExpression(styleAttribute, context.scopes)
        : null;
      if (
        (styleAttribute && !styleExpression) ||
        styleExpression?.properties.some((property) => getStylePropertyKey(property) === null)
      ) {
        return;
      }
      const tokens =
        className && hasCapabilityOrUnspecified(context.settings, "tailwind")
          ? splitTailwindClassName(className)
          : [];
      const tailwindBackground = getStaticTailwindBackgroundImage(tokens);
      if (tailwindBackground.isAmbiguous) return;
      const inlineBackgroundProperty = getEffectiveStylePropertyAmong(
        styleExpression?.properties,
        BACKGROUND_STYLE_PROPERTY_NAMES,
      );
      const inlineBackgroundValue = inlineBackgroundProperty
        ? getStylePropertyStringValue(inlineBackgroundProperty)
        : null;
      const backgroundValue =
        inlineBackgroundProperty && !tailwindBackground.isImportant
          ? inlineBackgroundValue
          : tailwindBackground.value;
      if (!backgroundValue || !hasDecorativeRadialSpotlightGradient(backgroundValue)) return;

      const tailwindSurface = getTailwindSurfaceEvidence(tokens);
      if (tailwindSurface.widthIsAmbiguous || tailwindSurface.heightIsAmbiguous) return;
      const inlineWidthProperty = getEffectiveStyleProperty(styleExpression?.properties, "width");
      const inlineHeightProperty = getEffectiveStyleProperty(styleExpression?.properties, "height");
      const inlineWidthPx = inlineWidthProperty
        ? parseStaticLengthPx(
            getStylePropertyNumberValue(inlineWidthProperty) ??
              getStylePropertyStringValue(inlineWidthProperty),
          )
        : null;
      const inlineHeightPx = inlineHeightProperty
        ? parseStaticLengthPx(
            getStylePropertyNumberValue(inlineHeightProperty) ??
              getStylePropertyStringValue(inlineHeightProperty),
          )
        : null;
      const widthPx = tailwindSurface.widthIsImportant
        ? tailwindSurface.widthPx
        : inlineWidthProperty
          ? inlineWidthPx
          : tailwindSurface.widthPx;
      const heightPx = tailwindSurface.heightIsImportant
        ? tailwindSurface.heightPx
        : inlineHeightProperty
          ? inlineHeightPx
          : tailwindSurface.heightPx;
      const hasWidth = tailwindSurface.widthIsImportant
        ? tailwindSurface.hasWidth
        : inlineWidthProperty !== null || tailwindSurface.hasWidth;
      const hasHeight = tailwindSurface.heightIsImportant
        ? tailwindSurface.hasHeight
        : inlineHeightProperty !== null || tailwindSurface.hasHeight;
      const positionProperty = getEffectiveStyleProperty(styleExpression?.properties, "position");
      const positionIsFixed = tailwindSurface.positionIsAmbiguous
        ? null
        : tailwindSurface.positionIsImportant
          ? tailwindSurface.positionIsFixed
          : positionProperty
            ? getStylePropertyStringValue(positionProperty)?.toLowerCase() === "fixed"
            : tailwindSurface.positionIsFixed;
      const insetEdgesAreZero = [
        getEffectiveInsetEdgeIsZero(
          styleExpression?.properties,
          INLINE_TOP_PROPERTY_NAMES,
          tailwindSurface.insetTop,
        ),
        getEffectiveInsetEdgeIsZero(
          styleExpression?.properties,
          INLINE_RIGHT_PROPERTY_NAMES,
          tailwindSurface.insetRight,
        ),
        getEffectiveInsetEdgeIsZero(
          styleExpression?.properties,
          INLINE_BOTTOM_PROPERTY_NAMES,
          tailwindSurface.insetBottom,
        ),
        getEffectiveInsetEdgeIsZero(
          styleExpression?.properties,
          INLINE_LEFT_PROPERTY_NAMES,
          tailwindSurface.insetLeft,
        ),
      ].every((isZero) => isZero === true);
      const isFixedViewport =
        !hasWidth && !hasHeight && positionIsFixed === true && insetEdgesAreZero;
      const isLargeSurface =
        isFixedViewport ||
        (widthPx !== null &&
          widthPx >= DECORATIVE_RADIAL_SPOTLIGHT_MIN_WIDTH_PX &&
          heightPx !== null &&
          heightPx >= DECORATIVE_RADIAL_SPOTLIGHT_MIN_HEIGHT_PX);
      if (!isLargeSurface) return;
      context.report({
        node: inlineBackgroundProperty ?? node,
        message:
          "This large translucent radial glow is generic decorative scaffolding. Replace it with a visual treatment tied to the product or simplify the surface.",
      });
    },
  }),
});
