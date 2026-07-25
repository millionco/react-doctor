import {
  INSET_SIDE_TAB_MAX_WIDTH_PX,
  INSET_SIDE_TAB_MIN_WIDTH_PX,
  PSEUDO_SIDE_TAB_MAX_EDGE_INSET_PX,
  SHORT_DECORATIVE_LABEL_MAX_CHARACTERS,
  SIDE_TAB_GLYPH_MAX_SIZE_PX,
  SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX,
  SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX,
  SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxPropStringValue } from "../../utils/get-jsx-prop-string-value.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { hasJsxPropIgnoreCase } from "../../utils/has-jsx-prop-ignore-case.js";
import { isInteractiveElement } from "../../utils/is-interactive-element.js";
import { isInteractiveRole } from "../../utils/is-interactive-role.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { hasColorChroma } from "./utils/has-color-chroma.js";
import { parseStaticTailwindLengthPx } from "./utils/parse-static-tailwind-length-px.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";

interface ParsedShadowLength {
  hasPixelUnit: boolean;
  value: number;
}

interface ParsedInsetSideTabShadow {
  edgeLabel: string;
  widthPx: number;
}

interface TailwindInsetSideTabShadow {
  isImportant: boolean;
  shadow: ParsedInsetSideTabShadow;
}

interface TailwindPseudoSideTabStripe {
  edgeLabel: string;
  pseudoElementName: string;
  widthPx: number;
}

interface TailwindPseudoOffsetResolution {
  isAmbiguous: boolean;
  valuePx: number | null;
}

const CHROMATIC_CSS_COLOR_KEYWORDS = new Set([
  "aqua",
  "blue",
  "coral",
  "crimson",
  "fuchsia",
  "gold",
  "green",
  "lime",
  "maroon",
  "navy",
  "olive",
  "orange",
  "pink",
  "purple",
  "rebeccapurple",
  "red",
  "teal",
  "yellow",
]);
const SHADOW_LENGTH_PATTERN = /^-?(?:\d+(?:\.\d+)?|\.\d+)(px)?$/i;
const TAILWIND_SHADOW_GEOMETRY_PATTERN = /^shadow(?:-(?:2xl|inner|lg|md|none|sm|xl|xs|\[.+\]))?$/;
const TAILWIND_ARBITRARY_SHADOW_PATTERN = /^shadow-\[(.+)\]$/;
const ZERO_ALPHA_PATTERN = /^(?:0+(?:\.0*)?|\.0+)%?$/;
const PSEUDO_ELEMENT_NAMES = ["before", "after"];
const TAILWIND_BACKGROUND_COLOR_PATTERN =
  /^bg-(?:transparent|black|white|current|inherit|(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+|\[(?!url\(|(?:image|length|position|size):).+\])(?:\/.+)?$/;
const CHROMATIC_TAILWIND_BACKGROUND_PATTERN =
  /^bg-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+(?:\/.+)?$/;
const PSEUDO_SIDE_TAB_CONTEXT_PATTERN =
  /(?:^|[-_:])(?:badge|callout|label|menu-item|nav-item|section-label|side-?tab|tab)(?:$|[-_:])/i;
const PSEUDO_SIDE_TAB_ART_PATTERN =
  /(?:^|[-_:])(?:avatar|brand-mark|glyph|icon|logo|logo-mark|mark)(?:$|[-_:])/i;
const PSEUDO_INTERACTION_OR_SELECTION_VARIANT_PATTERN =
  /(?:hover|focus|active|checked|target|selection|aria-(?:current|selected)|data-(?:active|current|selected))/i;
const STATIC_SELECTED_OR_CURRENT_CLASS_PATTERN =
  /(?:^|[-_:])(?:active|current|selected)(?:$|[-_:])/i;
const PSEUDO_DISPLAY_UTILITY_PATTERN =
  /^(?:block|contents|flex|grid|hidden|inline|inline-block|inline-flex|inline-grid)$/;
const PSEUDO_VISIBILITY_UTILITY_PATTERN = /^(?:visible|invisible|collapse)$/;
const PSEUDO_OPACITY_UTILITY_PATTERN = /^opacity-(.+)$/;
const PSEUDO_SIDE_TAB_SAFE_ELEMENT_PATTERN =
  /(?:^|\.)(?:blockquote|code|hr|pre|table|tbody|td|tfoot|th|thead|tr)$/i;

const splitShadowLayerTokens = (shadowValue: string): string[] | null => {
  const tokens: string[] = [];
  let currentToken = "";
  let parenthesisDepth = 0;

  for (const character of shadowValue) {
    if (character === "(") {
      parenthesisDepth += 1;
      currentToken += character;
      continue;
    }
    if (character === ")") {
      if (parenthesisDepth === 0) return null;
      parenthesisDepth -= 1;
      currentToken += character;
      continue;
    }
    if (character === "," && parenthesisDepth === 0) return null;
    if (/\s/.test(character) && parenthesisDepth === 0) {
      if (currentToken) tokens.push(currentToken);
      currentToken = "";
      continue;
    }
    currentToken += character;
  }

  if (parenthesisDepth !== 0) return null;
  if (currentToken) tokens.push(currentToken);
  return tokens;
};

const parseShadowLength = (token: string): ParsedShadowLength | null => {
  const match = token.match(SHADOW_LENGTH_PATTERN);
  if (!match) return null;
  return {
    hasPixelUnit: Boolean(match[1]),
    value: parseFloat(token),
  };
};

const isFullyTransparentColor = (color: string): boolean => {
  const normalizedColor = color.trim().toLowerCase();
  if (normalizedColor === "transparent") return true;
  const hexDigits = normalizedColor.match(/^#([0-9a-f]{4}|[0-9a-f]{8})$/)?.[1];
  if (hexDigits?.length === 4 && hexDigits.endsWith("0")) return true;
  if (hexDigits?.length === 8 && hexDigits.endsWith("00")) return true;

  const functionArguments = normalizedColor.match(/^(?:rgb|hsl)a?\((.*)\)$/)?.[1];
  if (!functionArguments) return false;
  const slashAlpha = functionArguments.match(/\/\s*([^/]+)$/)?.[1];
  if (slashAlpha) return ZERO_ALPHA_PATTERN.test(slashAlpha.trim());
  const legacyArguments = functionArguments.split(",");
  return (
    legacyArguments.length === 4 &&
    ZERO_ALPHA_PATTERN.test(legacyArguments[legacyArguments.length - 1]?.trim() ?? "")
  );
};

const hasResolvableColorChroma = (color: string): boolean => {
  if (isFullyTransparentColor(color)) return false;
  const parsedColor = parseColorToRgb(color);
  if (parsedColor) return hasColorChroma(parsedColor);
  return CHROMATIC_CSS_COLOR_KEYWORDS.has(color.trim().toLowerCase());
};

const parseInsetSideTabShadow = (shadowValue: string): ParsedInsetSideTabShadow | null => {
  const tokens = splitShadowLayerTokens(shadowValue);
  if (!tokens) return null;
  const insetTokens = tokens.filter((token) => token.toLowerCase() === "inset");
  if (insetTokens.length !== 1) return null;

  const shadowLengths: ParsedShadowLength[] = [];
  const colorTokens: string[] = [];
  for (const token of tokens) {
    if (token.toLowerCase() === "inset") continue;
    const shadowLength = parseShadowLength(token);
    if (shadowLength) shadowLengths.push(shadowLength);
    else colorTokens.push(token);
  }
  if (shadowLengths.length < 2 || shadowLengths.length > 4 || colorTokens.length !== 1) return null;

  const horizontalOffset = shadowLengths[0];
  const verticalOffset = shadowLengths[1];
  const blurRadius = shadowLengths[2]?.value ?? 0;
  const spreadRadius = shadowLengths[3]?.value ?? 0;
  if (!horizontalOffset || !verticalOffset || blurRadius !== 0 || spreadRadius !== 0) return null;
  if (
    (horizontalOffset.value !== 0 && !horizontalOffset.hasPixelUnit) ||
    (verticalOffset.value !== 0 && !verticalOffset.hasPixelUnit)
  ) {
    return null;
  }

  const horizontalWidth = Math.abs(horizontalOffset.value);
  const verticalWidth = Math.abs(verticalOffset.value);
  const isHorizontalEdge =
    horizontalWidth >= INSET_SIDE_TAB_MIN_WIDTH_PX &&
    horizontalWidth <= INSET_SIDE_TAB_MAX_WIDTH_PX &&
    verticalWidth === 0;
  const isVerticalEdge =
    verticalWidth >= INSET_SIDE_TAB_MIN_WIDTH_PX &&
    verticalWidth <= INSET_SIDE_TAB_MAX_WIDTH_PX &&
    horizontalWidth === 0;
  if ((!isHorizontalEdge && !isVerticalEdge) || !hasResolvableColorChroma(colorTokens[0])) {
    return null;
  }

  if (isHorizontalEdge) {
    return {
      edgeLabel: horizontalOffset.value > 0 ? "left" : "right",
      widthPx: horizontalWidth,
    };
  }
  return {
    edgeLabel: verticalOffset.value > 0 ? "top" : "bottom",
    widthPx: verticalWidth,
  };
};

const isStaticallyFalseJsxAttribute = (attribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const attributeValue = attribute.value;
  if (!attributeValue) return false;
  if (isNodeOfType(attributeValue, "Literal")) {
    return attributeValue.value === false || attributeValue.value === "false";
  }
  if (!isNodeOfType(attributeValue, "JSXExpressionContainer")) return false;
  return (
    isNodeOfType(attributeValue.expression, "Literal") &&
    (attributeValue.expression.value === false || attributeValue.expression.value === "false")
  );
};

const isInteractiveOrSelectedIndicator = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const elementType = resolveJsxElementType(openingElement);
  if (isInteractiveElement(elementType, openingElement)) return true;
  const selectedAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "aria-selected");
  const currentAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "aria-current");
  if (
    (selectedAttribute && !isStaticallyFalseJsxAttribute(selectedAttribute)) ||
    (currentAttribute && !isStaticallyFalseJsxAttribute(currentAttribute))
  ) {
    return true;
  }
  const roleAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "role");
  const role = roleAttribute ? getJsxPropStringValue(roleAttribute)?.trim().split(/\s+/)[0] : null;
  return Boolean(role && isInteractiveRole(role.toLowerCase()));
};

const getEffectiveTailwindShadowResolution = (tokens: string[]) =>
  resolveEffectiveTailwindClassNameToken(tokens, (utility) =>
    TAILWIND_SHADOW_GEOMETRY_PATTERN.test(utility),
  );

const getTailwindInsetSideTabShadow = (
  classNameTokens: string[],
): TailwindInsetSideTabShadow | null => {
  const shadowResolution = getEffectiveTailwindShadowResolution(classNameTokens);
  if (shadowResolution.isAmbiguous || !shadowResolution.utility) return null;
  const arbitraryShadowValue = shadowResolution.utility.match(
    TAILWIND_ARBITRARY_SHADOW_PATTERN,
  )?.[1];
  if (!arbitraryShadowValue) return null;
  const shadow = parseInsetSideTabShadow(arbitraryShadowValue.replace(/_/g, " "));
  return shadow ? { isImportant: shadowResolution.isImportant, shadow } : null;
};

const hasImportantTailwindShadow = (classNameTokens: string[]): boolean =>
  classNameTokens.some((classNameToken) => {
    const parsedToken = parseTailwindClassNameToken(classNameToken);
    return (
      parsedToken.variants.length === 0 &&
      parsedToken.isImportant &&
      TAILWIND_SHADOW_GEOMETRY_PATTERN.test(parsedToken.utility)
    );
  });

const hasChromaticTailwindBackground = (utility: string): boolean => {
  if (CHROMATIC_TAILWIND_BACKGROUND_PATTERN.test(utility)) {
    const opacityModifier = utility.match(/\/(.+)$/)?.[1]?.replace(/^\[|\]$/g, "");
    return !opacityModifier || !ZERO_ALPHA_PATTERN.test(opacityModifier);
  }
  const arbitraryColorMatch = utility.match(/^bg-\[(?:color:)?([^\]]+)\](?:\/(.+))?$/);
  const arbitraryColor = arbitraryColorMatch?.[1];
  const opacityModifier = arbitraryColorMatch?.[2]?.replace(/^\[|\]$/g, "");
  return Boolean(
    arbitraryColor &&
    (!opacityModifier || !ZERO_ALPHA_PATTERN.test(opacityModifier)) &&
    !isFullyTransparentColor(arbitraryColor) &&
    hasResolvableColorChroma(arbitraryColor),
  );
};

const getStaticPseudoUtilities = (
  classNameTokens: string[],
  pseudoElementName: string,
): string[] | null => {
  const utilities: string[] = [];
  for (const classNameToken of classNameTokens) {
    const parsedToken = parseTailwindClassNameToken(classNameToken);
    if (!parsedToken.variants.includes(pseudoElementName)) continue;
    if (
      parsedToken.variants.length !== 1 ||
      parsedToken.variants[0] !== pseudoElementName ||
      parsedToken.variants.some((variant) =>
        PSEUDO_INTERACTION_OR_SELECTION_VARIANT_PATTERN.test(variant),
      )
    ) {
      return null;
    }
    utilities.push(parsedToken.isImportant ? `!${parsedToken.utility}` : parsedToken.utility);
  }
  return utilities;
};

const getTailwindDimensionResolution = (utilities: string[], dimensionPrefix: "h" | "w") =>
  resolveEffectiveTailwindClassNameToken(
    utilities,
    (utility) => utility.startsWith(`${dimensionPrefix}-`) || utility.startsWith("size-"),
    [],
  );

const getTailwindDimensionPx = (
  utility: string | null,
  dimensionPrefix: "h" | "w",
): number | null => {
  if (!utility) return null;
  return utility.startsWith("size-")
    ? parseStaticTailwindLengthPx(utility, "size")
    : parseStaticTailwindLengthPx(utility, dimensionPrefix);
};

const isFullTailwindDimension = (utility: string | null, dimensionPrefix: "h" | "w"): boolean =>
  utility === `${dimensionPrefix}-full` || utility === "size-full";

const getTailwindOffsetUtilityValue = (
  utility: string,
  sideName: "bottom" | "left" | "right" | "top",
): number | null | undefined => {
  const isNegative = utility.startsWith("-");
  const normalizedUtility = isNegative ? utility.slice(1) : utility;
  const axisPrefix = sideName === "left" || sideName === "right" ? "inset-x" : "inset-y";
  const matchingPrefix = normalizedUtility.startsWith(`${sideName}-`)
    ? sideName
    : normalizedUtility.startsWith(`${axisPrefix}-`)
      ? axisPrefix
      : /^inset-(?![xy]-)/.test(normalizedUtility)
        ? "inset"
        : null;
  if (!matchingPrefix) return undefined;
  if (normalizedUtility === `${matchingPrefix}-auto`) return null;
  const valuePx = parseStaticTailwindLengthPx(normalizedUtility, matchingPrefix);
  return valuePx === null ? null : valuePx * (isNegative ? -1 : 1);
};

const getTailwindPseudoOffsetResolution = (
  utilities: string[],
  sideName: "bottom" | "left" | "right" | "top",
): TailwindPseudoOffsetResolution => {
  const parsedUtilities = utilities.map(parseTailwindClassNameToken);
  const relevantUtilities = parsedUtilities.filter(
    (parsedUtility) => getTailwindOffsetUtilityValue(parsedUtility.utility, sideName) !== undefined,
  );
  const hasImportantUtility = relevantUtilities.some((parsedUtility) => parsedUtility.isImportant);
  const effectiveValues = new Set(
    relevantUtilities
      .filter((parsedUtility) => !hasImportantUtility || parsedUtility.isImportant)
      .map((parsedUtility) => getTailwindOffsetUtilityValue(parsedUtility.utility, sideName)),
  );
  if (effectiveValues.size !== 1) {
    return {
      isAmbiguous: effectiveValues.size > 1,
      valuePx: null,
    };
  }
  const valuePx = effectiveValues.values().next().value ?? null;
  return {
    isAmbiguous: valuePx === null,
    valuePx,
  };
};

const isNearlyFullPseudoAxis = (
  utilities: string[],
  dimensionPrefix: "h" | "w",
  startSide: "left" | "top",
  endSide: "bottom" | "right",
): boolean => {
  const dimensionResolution = getTailwindDimensionResolution(utilities, dimensionPrefix);
  if (dimensionResolution.isAmbiguous) return false;
  if (dimensionResolution.utility) {
    const startOffset = getTailwindPseudoOffsetResolution(utilities, startSide);
    const endOffset = getTailwindPseudoOffsetResolution(utilities, endSide);
    return (
      isFullTailwindDimension(dimensionResolution.utility, dimensionPrefix) &&
      !startOffset.isAmbiguous &&
      !endOffset.isAmbiguous &&
      (startOffset.valuePx === null || startOffset.valuePx === 0) &&
      (endOffset.valuePx === null || endOffset.valuePx === 0)
    );
  }
  const startOffset = getTailwindPseudoOffsetResolution(utilities, startSide);
  const endOffset = getTailwindPseudoOffsetResolution(utilities, endSide);
  return (
    !startOffset.isAmbiguous &&
    !endOffset.isAmbiguous &&
    startOffset.valuePx !== null &&
    endOffset.valuePx !== null &&
    startOffset.valuePx >= 0 &&
    startOffset.valuePx <= PSEUDO_SIDE_TAB_MAX_EDGE_INSET_PX &&
    endOffset.valuePx >= 0 &&
    endOffset.valuePx <= PSEUDO_SIDE_TAB_MAX_EDGE_INSET_PX
  );
};

const getAnchoredPseudoEdge = (
  utilities: string[],
  startSide: "left" | "top",
  endSide: "bottom" | "right",
): string | null => {
  const startOffset = getTailwindPseudoOffsetResolution(utilities, startSide);
  const endOffset = getTailwindPseudoOffsetResolution(utilities, endSide);
  if (startOffset.isAmbiguous || endOffset.isAmbiguous) return null;
  const isStartAnchored = startOffset.valuePx === 0;
  const isEndAnchored = endOffset.valuePx === 0;
  if (isStartAnchored === isEndAnchored) return null;
  return isStartAnchored ? startSide : endSide;
};

const getTailwindPseudoSideTabStripe = (
  classNameTokens: string[],
): TailwindPseudoSideTabStripe | null => {
  for (const pseudoElementName of PSEUDO_ELEMENT_NAMES) {
    const utilities = getStaticPseudoUtilities(classNameTokens, pseudoElementName);
    if (!utilities?.length) continue;
    const positionResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => ["absolute", "fixed", "relative", "static", "sticky"].includes(utility),
      [],
    );
    const backgroundResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => TAILWIND_BACKGROUND_COLOR_PATTERN.test(utility),
      [],
    );
    const displayResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => PSEUDO_DISPLAY_UTILITY_PATTERN.test(utility),
      [],
    );
    const visibilityResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => PSEUDO_VISIBILITY_UTILITY_PATTERN.test(utility),
      [],
    );
    const opacityResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => PSEUDO_OPACITY_UTILITY_PATTERN.test(utility),
      [],
    );
    const backgroundOpacityResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => utility.startsWith("bg-opacity-"),
      [],
    );
    const contentResolution = resolveEffectiveTailwindClassNameToken(
      utilities,
      (utility) => utility.startsWith("content-") || utility.startsWith("[content:"),
      [],
    );
    if (
      positionResolution.isAmbiguous ||
      backgroundResolution.isAmbiguous ||
      displayResolution.isAmbiguous ||
      visibilityResolution.isAmbiguous ||
      opacityResolution.isAmbiguous ||
      backgroundOpacityResolution.isAmbiguous ||
      contentResolution.isAmbiguous ||
      positionResolution.utility !== "absolute" ||
      !backgroundResolution.utility ||
      !hasChromaticTailwindBackground(backgroundResolution.utility) ||
      displayResolution.utility === "hidden" ||
      displayResolution.utility === "contents" ||
      visibilityResolution.utility === "invisible" ||
      visibilityResolution.utility === "collapse" ||
      contentResolution.utility === "content-none"
    ) {
      continue;
    }
    const opacityValue = opacityResolution.utility?.match(PSEUDO_OPACITY_UTILITY_PATTERN)?.[1];
    const backgroundOpacityValue = backgroundOpacityResolution.utility?.slice("bg-opacity-".length);
    if (
      (opacityValue && ZERO_ALPHA_PATTERN.test(opacityValue.replace(/^\[|\]$/g, ""))) ||
      (backgroundOpacityValue &&
        ZERO_ALPHA_PATTERN.test(backgroundOpacityValue.replace(/^\[|\]$/g, "")))
    ) {
      continue;
    }

    const widthResolution = getTailwindDimensionResolution(utilities, "w");
    const heightResolution = getTailwindDimensionResolution(utilities, "h");
    if (widthResolution.isAmbiguous || heightResolution.isAmbiguous) continue;
    const widthPx = getTailwindDimensionPx(widthResolution.utility, "w");
    const heightPx = getTailwindDimensionPx(heightResolution.utility, "h");
    const isVerticalStripe =
      widthPx !== null &&
      widthPx >= INSET_SIDE_TAB_MIN_WIDTH_PX &&
      widthPx <= INSET_SIDE_TAB_MAX_WIDTH_PX &&
      isNearlyFullPseudoAxis(utilities, "h", "top", "bottom");
    const isHorizontalStripe =
      heightPx !== null &&
      heightPx >= INSET_SIDE_TAB_MIN_WIDTH_PX &&
      heightPx <= INSET_SIDE_TAB_MAX_WIDTH_PX &&
      isNearlyFullPseudoAxis(utilities, "w", "left", "right");
    if (isVerticalStripe === isHorizontalStripe) continue;
    const edgeLabel = isVerticalStripe
      ? getAnchoredPseudoEdge(utilities, "left", "right")
      : getAnchoredPseudoEdge(utilities, "top", "bottom");
    if (!edgeLabel) continue;
    const stripeWidthPx = isVerticalStripe ? widthPx : heightPx;
    if (stripeWidthPx === null) continue;
    return {
      edgeLabel,
      pseudoElementName,
      widthPx: stripeWidthPx,
    };
  }
  return null;
};

const hasActualSelectedOrCurrentState = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const selectedAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "aria-selected");
  const currentAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "aria-current");
  const dataSelectedAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "data-selected");
  const dataStateAttribute = hasJsxPropIgnoreCase(openingElement.attributes, "data-state");
  const dataStateValue = dataStateAttribute
    ? getJsxPropStringValue(dataStateAttribute)?.toLowerCase()
    : null;
  return Boolean(
    (selectedAttribute && !isStaticallyFalseJsxAttribute(selectedAttribute)) ||
    (currentAttribute && !isStaticallyFalseJsxAttribute(currentAttribute)) ||
    (dataSelectedAttribute && !isStaticallyFalseJsxAttribute(dataSelectedAttribute)) ||
    (dataStateAttribute &&
      (!dataStateValue || ["active", "current", "selected"].includes(dataStateValue))),
  );
};

const isDynamicJsxContent = (node: EsTreeNode): boolean => {
  if (isNodeOfType(node, "JSXExpressionContainer")) {
    return !(
      isNodeOfType(node.expression, "Literal") ||
      (isNodeOfType(node.expression, "TemplateLiteral") && node.expression.expressions.length === 0)
    );
  }
  if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
    return node.children.some(isDynamicJsxContent);
  }
  return false;
};

const hasStaticSideTabLabelContext = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  className: string,
): boolean => {
  if (
    splitTailwindClassName(className).some((token) => PSEUDO_SIDE_TAB_CONTEXT_PATTERN.test(token))
  ) {
    return true;
  }
  const element = isNodeOfType(openingElement.parent, "JSXElement") ? openingElement.parent : null;
  if (!element || element.children.some(isDynamicJsxContent)) return false;
  const labelText = getStaticJsxText(element).replace(/\s+/g, " ").trim();
  return (
    labelText.length > 0 &&
    labelText.length <= SHORT_DECORATIVE_LABEL_MAX_CHARACTERS &&
    /[\p{L}\p{N}]/u.test(labelText)
  );
};

const isGlyphOrLogoContext = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  classNameTokens: string[],
): boolean => {
  const elementType = resolveJsxElementType(openingElement);
  if (
    /^(?:canvas|img|path|picture|svg|use)$/i.test(elementType) ||
    /(?:avatar|glyph|icon|logo|mark)$/i.test(elementType)
  ) {
    return true;
  }
  if (
    classNameTokens.some((classNameToken) => {
      const parsedToken = parseTailwindClassNameToken(classNameToken);
      return (
        parsedToken.variants.length === 0 && PSEUDO_SIDE_TAB_ART_PATTERN.test(parsedToken.utility)
      );
    })
  ) {
    return true;
  }
  const widthResolution = getTailwindDimensionResolution(classNameTokens, "w");
  const heightResolution = getTailwindDimensionResolution(classNameTokens, "h");
  const widthPx = getTailwindDimensionPx(widthResolution.utility, "w");
  const heightPx = getTailwindDimensionPx(heightResolution.utility, "h");
  const element = isNodeOfType(openingElement.parent, "JSXElement") ? openingElement.parent : null;
  const staticLabelText = getStaticJsxText(element).replace(/\s+/g, " ").trim();
  return (
    !widthResolution.isAmbiguous &&
    !heightResolution.isAmbiguous &&
    widthPx !== null &&
    heightPx !== null &&
    widthPx <= SIDE_TAB_GLYPH_MAX_SIZE_PX &&
    heightPx <= SIDE_TAB_GLYPH_MAX_SIZE_PX &&
    staticLabelText.length === 0
  );
};

const isHorizontalUnderlineHost = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const elementType = resolveJsxElementType(openingElement);
  return /^(?:a|area|button)$/i.test(elementType) || /(?:button|link)$/i.test(elementType);
};

const hasStaticSelectedOrCurrentClass = (classNameTokens: string[]): boolean =>
  classNameTokens.some((classNameToken) => {
    const parsedToken = parseTailwindClassNameToken(classNameToken);
    return (
      parsedToken.variants.length === 0 &&
      STATIC_SELECTED_OR_CURRENT_CLASS_PATTERN.test(parsedToken.utility)
    );
  });

const hasStaticPseudoPositioningContext = (classNameTokens: string[]): boolean => {
  const positionResolution = resolveEffectiveTailwindClassNameToken(classNameTokens, (utility) =>
    ["absolute", "fixed", "relative", "static", "sticky"].includes(utility),
  );
  return (
    !positionResolution.isAmbiguous &&
    Boolean(
      positionResolution.utility &&
      ["absolute", "fixed", "relative", "sticky"].includes(positionResolution.utility),
    )
  );
};

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
  title: "Thick one-sided stripe",
  tags: ["design", "test-noise"],
  severity: "warn",
  // Default off: subjective design / house-style preference, not a
  // correctness, performance, or accessibility issue. Opt in to enforce it.
  defaultEnabled: false,
  recommendation:
    "Use a background change, a thin neutral edge, or a subtler surface treatment instead of a thick one-sided stripe.",
  create: (context: RuleContext) => ({
    JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
      const expression = getInlineStyleExpression(node);
      if (!expression) return;
      const openingElement = isNodeOfType(node.parent, "JSXOpeningElement") ? node.parent : null;
      const className = openingElement ? getStringFromClassNameAttr(openingElement) : null;
      if (className && hasSpinnerClass(className)) return;
      const classNameTokens = className ? splitTailwindClassName(className) : [];

      const shadowProperty = getEffectiveStyleProperty(expression.properties, "boxShadow");
      const shadowValue = shadowProperty ? getStylePropertyStringValue(shadowProperty) : null;
      const insetSideTabShadow = shadowValue ? parseInsetSideTabShadow(shadowValue) : null;
      const isImportantTailwindShadowEffective =
        hasCapabilityOrUnspecified(context.settings, "tailwind") &&
        hasImportantTailwindShadow(classNameTokens);
      if (
        shadowProperty &&
        insetSideTabShadow &&
        openingElement &&
        !isImportantTailwindShadowEffective &&
        !isInteractiveOrSelectedIndicator(openingElement)
      ) {
        context.report({
          node: shadowProperty,
          message: `Your users see an off, dated inset stripe on one side (${insetSideTabShadow.edgeLabel}: ${insetSideTabShadow.widthPx}px), so use a subtler surface treatment or drop it.`,
        });
      }

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
      const tailwindInsetSideTabShadow = getTailwindInsetSideTabShadow(classNameTokens);
      if (tailwindInsetSideTabShadow && !isInteractiveOrSelectedIndicator(node)) {
        const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
        const styleExpression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
        const hasUnknownInlineStyleProperty = Boolean(
          styleExpression?.properties.some((property) => getStylePropertyKey(property) === null),
        );
        const hasInlineShadowOverride = Boolean(
          styleAttribute &&
          (!styleExpression ||
            hasUnknownInlineStyleProperty ||
            getEffectiveStyleProperty(styleExpression.properties, "boxShadow")),
        );
        if (tailwindInsetSideTabShadow.isImportant || !hasInlineShadowOverride) {
          context.report({
            node,
            message: `Your users see an off, dated inset stripe on one side (${tailwindInsetSideTabShadow.shadow.edgeLabel}: ${tailwindInsetSideTabShadow.shadow.widthPx}px), so use a subtler surface treatment or drop it.`,
          });
        }
      }

      const pseudoSideTabStripe = getTailwindPseudoSideTabStripe(classNameTokens);
      const elementType = resolveJsxElementType(node);
      if (
        pseudoSideTabStripe &&
        !PSEUDO_SIDE_TAB_SAFE_ELEMENT_PATTERN.test(elementType) &&
        !hasActualSelectedOrCurrentState(node) &&
        !hasStaticSelectedOrCurrentClass(classNameTokens) &&
        hasStaticSideTabLabelContext(node, classStr) &&
        hasStaticPseudoPositioningContext(classNameTokens) &&
        !isGlyphOrLogoContext(node, classNameTokens) &&
        !(
          (pseudoSideTabStripe.edgeLabel === "top" || pseudoSideTabStripe.edgeLabel === "bottom") &&
          isHorizontalUnderlineHost(node)
        )
      ) {
        context.report({
          node,
          message: `Your users see an off, dated ${pseudoSideTabStripe.widthPx}px ${pseudoSideTabStripe.pseudoElementName} stripe on the ${pseudoSideTabStripe.edgeLabel} edge, so use a subtler surface treatment or drop it.`,
        });
      }

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
