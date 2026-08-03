import { TAILWIND_DISPLAY_TOKENS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isGeneratedImageRenderContext } from "../../utils/is-generated-image-render-context.js";
import { isLiteralVoidExpression } from "../../utils/is-literal-void-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";
import {
  createStaticCssStyleResolver,
  type StaticCssStyle,
  type StaticCssStyleResolver,
} from "./utils/create-static-css-style-resolver.js";

const CSS_LENGTH_PATTERN =
  /^(\d*\.?\d+)(?:cap|ch|cm|cqb|cqh|cqi|cqmax|cqmin|cqw|dvb|dvh|dvi|dvmax|dvmin|dvw|em|ex|ic|in|lh|lvb|lvh|lvi|lvmax|lvmin|lvw|mm|pc|pt|px|q|rcap|rch|rem|rex|ric|rlh|svb|svh|svi|svmax|svmin|svw|vb|vh|vi|vmax|vmin|vw|%)$/;
const CSS_VALUE_FUNCTION_PATTERN = /^(?:calc|clamp|max|min|var)\(/;
const KNOWN_NON_SIZING_TAILWIND_UTILITY_PATTERN =
  /^(?:-?m(?:[trblesxy])?-.+|border(?:-.+)?|collapse|grayscale(?:-.+)?|invisible|max-[hw]-.+|object-.+|opacity-.+|rounded(?:-.+)?|shadow(?:-.+)?|visible)$/;
const IMPLICIT_WIDTH_PARENT_ELEMENT_NAMES = new Set([
  "article",
  "aside",
  "blockquote",
  "details",
  "div",
  "dl",
  "fieldset",
  "figure",
  "footer",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "header",
  "hr",
  "li",
  "main",
  "nav",
  "ol",
  "p",
  "pre",
  "section",
  "ul",
]);

interface ReservedImageBoxEvidence {
  hasAspectRatio: boolean;
  hasHeight: boolean;
  hasWidth: boolean;
}

interface ExternalCssDimensionEvidence {
  reservesWithParent: boolean;
  reservesWithoutParent: boolean;
}

interface ExternalCssBoxEvidence extends ReservedImageBoxEvidence {
  heightReservesWithParent: boolean;
  widthReservesWithParent: boolean;
}

interface ParentBoxAxes {
  hasHeight: boolean;
  hasWidth: boolean;
}

const getStaticClassName = (node: EsTreeNodeOfType<"JSXOpeningElement">): string | null => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, "className", false);
  return attribute ? getStringLiteralAttributeValue(attribute) : null;
};

const tailwindDimensionMayReserveSpace = (
  utility: string | null,
  axis: "height" | "width",
): boolean => {
  if (
    !utility ||
    /-(?:auto|fit|min|max|0|\[(?:auto|fit-content|min-content|max-content|0(?:\.0+)?(?:[a-z%]+)?)\])$/.test(
      utility,
    )
  ) {
    return false;
  }
  if (
    axis === "height" &&
    /^(?:h|size)-(?:full|\d+(?:\.\d+)?\/\d+(?:\.\d+)?|\[[^\]]*%\])$/.test(utility)
  ) {
    return false;
  }
  return true;
};

const tailwindAspectRatioMayReserveSpace = (utility: string | null): boolean => {
  if (!utility || utility === "aspect-auto" || utility === "aspect-[auto]") return false;
  const rawRatio = utility.slice("aspect-".length).replace(/^\[|\]$/g, "");
  if (rawRatio === "square" || rawRatio === "video" || /^(?:var|calc)\(/.test(rawRatio)) {
    return true;
  }
  const ratioParts = rawRatio.split("/").map((part) => Number(part.trim()));
  return ratioParts.length === 2
    ? ratioParts.every((part) => Number.isFinite(part) && part > 0)
    : !/^\d/.test(rawRatio);
};

const getReservedClassBoxEvidence = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): ReservedImageBoxEvidence => {
  const className = getStaticClassName(node);
  if (!className) return { hasAspectRatio: false, hasHeight: false, hasWidth: false };
  const tokens = getUnvariantClassNameTokensWithImportantModifiers(className);
  const effectiveAspectRatio = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    utility.startsWith("aspect-"),
  );
  const effectiveWidth = getEffectiveTailwindClassNameToken(
    tokens,
    (utility) => utility.startsWith("size-") || utility.startsWith("w-"),
  );
  const effectiveHeight = getEffectiveTailwindClassNameToken(
    tokens,
    (utility) => utility.startsWith("h-") || utility.startsWith("size-"),
  );
  return {
    hasAspectRatio: tailwindAspectRatioMayReserveSpace(effectiveAspectRatio),
    hasWidth: tailwindDimensionMayReserveSpace(effectiveWidth, "width"),
    hasHeight: tailwindDimensionMayReserveSpace(effectiveHeight, "height"),
  };
};

const evidenceReservesBox = (
  evidence: ReservedImageBoxEvidence,
  hasImplicitWidth: boolean,
): boolean => {
  const hasWidth = evidence.hasWidth || hasImplicitWidth;
  return (
    (hasWidth && evidence.hasHeight) ||
    (evidence.hasAspectRatio && (hasWidth || evidence.hasHeight))
  );
};

const getExternalCssValues = (style: StaticCssStyle, property: string): ReadonlyArray<string> =>
  style.ambiguousProperties.has(property) ? [] : (style.valuesByProperty.get(property) ?? []);

const externalCssLengthReservesWithoutParent = (
  value: string,
  axis: "height" | "width",
): boolean => {
  if (!value || value === "auto" || value === "none") return false;
  if (/^(?:calc|clamp|max|min)\(/.test(value)) {
    return !value.includes("%") && !/\bauto\b/.test(value);
  }
  const lengthMatch = CSS_LENGTH_PATTERN.exec(value);
  if (!lengthMatch?.[1] || Number(lengthMatch[1]) <= 0) return false;
  return axis === "width" || !value.endsWith("%");
};

const externalCssLengthReservesWithParent = (value: string, axis: "height" | "width"): boolean => {
  if (externalCssLengthReservesWithoutParent(value, axis)) return true;
  if (/^(?:calc|clamp|max|min)\(/.test(value)) {
    return !/\b(?:auto|var)\b/.test(value);
  }
  const lengthMatch = CSS_LENGTH_PATTERN.exec(value);
  return Boolean(lengthMatch?.[1] && Number(lengthMatch[1]) > 0 && value.endsWith("%"));
};

const getExternalCssDimensionEvidence = (
  style: StaticCssStyle,
  property: "height" | "width",
): ExternalCssDimensionEvidence => {
  const values = getExternalCssValues(style, property);
  if (values.length === 0) {
    return { reservesWithParent: false, reservesWithoutParent: false };
  }
  const reservesWithoutParent = values.every((value) =>
    externalCssLengthReservesWithoutParent(value, property),
  );
  const reservesWithParent = values.every((value) =>
    externalCssLengthReservesWithParent(value, property),
  );
  return { reservesWithParent, reservesWithoutParent };
};

const externalCssAspectRatioReservesSpace = (style: StaticCssStyle): boolean => {
  const values = getExternalCssValues(style, "aspect-ratio");
  return (
    values.length > 0 &&
    values.every((value) => {
      const normalizedValue = value.replace(/^auto\s+/, "");
      const ratioParts = normalizedValue.split("/").map((part) => Number(part.trim()));
      return (
        ratioParts.length === 2 && ratioParts.every((part) => Number.isFinite(part) && part > 0)
      );
    })
  );
};

const getExternalCssBoxEvidence = (style: StaticCssStyle): ExternalCssBoxEvidence => {
  const width = getExternalCssDimensionEvidence(style, "width");
  const height = getExternalCssDimensionEvidence(style, "height");
  return {
    hasAspectRatio: externalCssAspectRatioReservesSpace(style),
    hasHeight: height.reservesWithoutParent,
    hasWidth: width.reservesWithoutParent,
    heightReservesWithParent: height.reservesWithParent,
    widthReservesWithParent: width.reservesWithParent,
  };
};

const getExternalCssBoxEvidenceWithInlineOverrides = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  resolver: StaticCssStyleResolver,
): ExternalCssBoxEvidence | null => {
  const externalEvidence = getExternalCssBoxEvidence(resolver.resolve(node));
  const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style", false);
  if (!styleAttribute) return externalEvidence;
  const expression = getInlineStyleExpression(styleAttribute, context.scopes);
  if (!expression) return null;
  const inlineEvidence = getReservedInlineBoxEvidence(node, context);
  const overridesAspectRatio = Boolean(
    getEffectiveStyleProperty(expression.properties, "aspectRatio"),
  );
  const overridesHeight = Boolean(getEffectiveStyleProperty(expression.properties, "height"));
  const overridesWidth = Boolean(getEffectiveStyleProperty(expression.properties, "width"));
  return {
    hasAspectRatio: overridesAspectRatio
      ? inlineEvidence.hasAspectRatio
      : externalEvidence.hasAspectRatio,
    hasHeight: overridesHeight ? inlineEvidence.hasHeight : externalEvidence.hasHeight,
    hasWidth: overridesWidth ? inlineEvidence.hasWidth : externalEvidence.hasWidth,
    heightReservesWithParent: overridesHeight ? false : externalEvidence.heightReservesWithParent,
    widthReservesWithParent: overridesWidth ? false : externalEvidence.widthReservesWithParent,
  };
};

const inlineStyleOverridesAny = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  propertyNames: ReadonlyArray<string>,
): boolean => {
  const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style", false);
  const expression = styleAttribute
    ? getInlineStyleExpression(styleAttribute, context.scopes)
    : null;
  return Boolean(
    expression &&
    propertyNames.some((propertyName) =>
      getEffectiveStyleProperty(expression.properties, propertyName),
    ),
  );
};

const getConsistentExternalCssValue = (style: StaticCssStyle, property: string): string | null => {
  const values = getExternalCssValues(style, property);
  return values.length > 0 && values.every((value) => value === values[0]) ? values[0] : null;
};

const externalCssHasPositiveFlexGrow = (style: StaticCssStyle): boolean => {
  const flexGrowValues = getExternalCssValues(style, "flex-grow");
  const flexValues = getExternalCssValues(style, "flex");
  const values = [...flexGrowValues, ...flexValues];
  return (
    values.length > 0 &&
    values.every((value) => {
      const flexGrow = Number(value.trim().split(/\s+/)[0]);
      return Number.isFinite(flexGrow) && flexGrow > 0;
    })
  );
};

const getExternalCssElementBoxAxes = (
  elementOpeningElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  resolver: StaticCssStyleResolver,
): ParentBoxAxes => {
  const style = resolver.resolve(elementOpeningElement);
  const evidence = getExternalCssBoxEvidenceWithInlineOverrides(
    elementOpeningElement,
    context,
    resolver,
  );
  if (!evidence) return { hasHeight: false, hasWidth: false };
  const elementName = resolveJsxElementType(elementOpeningElement);
  const element = elementOpeningElement.parent;
  const parentElement = element?.parent;
  const parentOpeningElement =
    isNodeOfType(element, "JSXElement") && isNodeOfType(parentElement, "JSXElement")
      ? parentElement.openingElement
      : null;
  const parentAxes = parentOpeningElement
    ? getExternalCssElementBoxAxes(parentOpeningElement, context, resolver)
    : { hasHeight: resolver.hasDefiniteReactRootHeight, hasWidth: true };
  let hasWidth =
    evidence.hasWidth ||
    (evidence.widthReservesWithParent && parentAxes.hasWidth) ||
    (elementName !== null && IMPLICIT_WIDTH_PARENT_ELEMENT_NAMES.has(elementName));
  let hasHeight = evidence.hasHeight || (evidence.heightReservesWithParent && parentAxes.hasHeight);
  if (!parentOpeningElement) return { hasHeight, hasWidth };
  if (
    inlineStyleOverridesAny(elementOpeningElement, context, ["alignSelf", "flex", "flexGrow"]) ||
    inlineStyleOverridesAny(parentOpeningElement, context, [
      "alignItems",
      "display",
      "flexDirection",
      "flexWrap",
    ])
  ) {
    return { hasHeight, hasWidth };
  }
  const parentStyle = resolver.resolve(parentOpeningElement);
  const display = getConsistentExternalCssValue(parentStyle, "display");
  const flexDirection = getConsistentExternalCssValue(parentStyle, "flex-direction") ?? "row";
  const flexWrap = getConsistentExternalCssValue(parentStyle, "flex-wrap") ?? "nowrap";
  const alignItems = getConsistentExternalCssValue(parentStyle, "align-items") ?? "stretch";
  const alignSelf = getConsistentExternalCssValue(style, "align-self") ?? "auto";
  const isFlexContainer = display === "flex" || display === "inline-flex";
  const isRowDirection = flexDirection === "row" || flexDirection === "row-reverse";
  const isColumnDirection = flexDirection === "column" || flexDirection === "column-reverse";
  if (isFlexContainer && (isRowDirection || isColumnDirection) && flexWrap === "nowrap") {
    if (externalCssHasPositiveFlexGrow(style)) {
      if (isRowDirection && parentAxes.hasWidth) hasWidth = true;
      if (isColumnDirection && parentAxes.hasHeight) hasHeight = true;
    }
    if (alignItems === "stretch" && (alignSelf === "auto" || alignSelf === "stretch")) {
      if (isRowDirection && parentAxes.hasHeight) hasHeight = true;
      if (isColumnDirection && parentAxes.hasWidth) hasWidth = true;
    }
  }
  if (evidence.hasAspectRatio) {
    hasHeight ||= hasWidth;
    hasWidth ||= hasHeight;
  }
  return { hasHeight, hasWidth };
};

const getExternalCssParentBoxAxes = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  resolver: StaticCssStyleResolver,
): ParentBoxAxes => {
  const imageElement = node.parent;
  const parentElement = imageElement?.parent;
  return isNodeOfType(imageElement, "JSXElement") && isNodeOfType(parentElement, "JSXElement")
    ? getExternalCssElementBoxAxes(parentElement.openingElement, context, resolver)
    : { hasHeight: false, hasWidth: false };
};

const hasReservedExternalCssBox = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  resolver: StaticCssStyleResolver,
): boolean => {
  const classNameAttribute = getAuthoritativeJsxAttribute(node.attributes, "className", false);
  let classEvidence: ReservedImageBoxEvidence = {
    hasAspectRatio: false,
    hasHeight: false,
    hasWidth: false,
  };
  let hasAspectRatioUtility = false;
  let hasHeightUtility = false;
  let hasWidthUtility = false;
  if (classNameAttribute) {
    const className = getStringLiteralAttributeValue(classNameAttribute);
    if (className === null) return false;
    classEvidence = getReservedClassBoxEvidence(node);
    for (const token of splitTailwindClassName(className)) {
      const utility = parseTailwindClassNameToken(token).utility;
      hasAspectRatioUtility ||= utility.startsWith("aspect-");
      hasHeightUtility ||= utility.startsWith("size-") || utility.startsWith("h-");
      hasWidthUtility ||= utility.startsWith("size-") || utility.startsWith("w-");
    }
  }
  const evidence = getExternalCssBoxEvidenceWithInlineOverrides(node, context, resolver);
  if (!evidence) return false;
  const combinedEvidence: ExternalCssBoxEvidence = {
    hasAspectRatio:
      classEvidence.hasAspectRatio || (!hasAspectRatioUtility && evidence.hasAspectRatio),
    hasHeight: classEvidence.hasHeight || (!hasHeightUtility && evidence.hasHeight),
    hasWidth: classEvidence.hasWidth || (!hasWidthUtility && evidence.hasWidth),
    heightReservesWithParent: !hasHeightUtility && evidence.heightReservesWithParent,
    widthReservesWithParent: !hasWidthUtility && evidence.widthReservesWithParent,
  };
  if (evidenceReservesBox(combinedEvidence, false)) return true;
  const parentAxes = getExternalCssParentBoxAxes(node, context, resolver);
  const hasWidth =
    combinedEvidence.hasWidth || (combinedEvidence.widthReservesWithParent && parentAxes.hasWidth);
  const hasHeight =
    combinedEvidence.hasHeight ||
    (combinedEvidence.heightReservesWithParent && parentAxes.hasHeight);
  return (hasWidth && hasHeight) || (combinedEvidence.hasAspectRatio && (hasWidth || hasHeight));
};

const hasReservedClassBox = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  hasImplicitWidth = false,
): boolean => evidenceReservesBox(getReservedClassBoxEvidence(node), hasImplicitWidth);

const hasAmbiguousBoxSizingClasses = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const className = getStaticClassName(node);
  if (!className) return false;
  const tokens = getUnvariantClassNameTokensWithImportantModifiers(className);
  const predicates = [
    (utility: string) => utility.startsWith("aspect-"),
    (utility: string) => utility.startsWith("size-") || utility.startsWith("w-"),
    (utility: string) => utility.startsWith("size-") || utility.startsWith("h-"),
  ];
  return predicates.some(
    (predicate) => resolveEffectiveTailwindClassNameToken(tokens, predicate).isAmbiguous,
  );
};

const isKnownTailwindBoxClass = (utility: string): boolean =>
  utility.startsWith("aspect-") ||
  utility.startsWith("size-") ||
  utility.startsWith("w-") ||
  utility.startsWith("h-") ||
  TAILWIND_DISPLAY_TOKENS.has(utility) ||
  KNOWN_NON_SIZING_TAILWIND_UTILITY_PATTERN.test(utility);

const hasOnlyKnownTailwindBoxClasses = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const className = getStaticClassName(node);
  if (!className) return false;
  const tokens = splitTailwindClassName(className);
  return (
    tokens.length > 0 &&
    tokens.every((token) => isKnownTailwindBoxClass(parseTailwindClassNameToken(token).utility))
  );
};

const classNameMayProvideExternalBox = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const attribute = getAuthoritativeJsxAttribute(node.attributes, "className", false);
  if (!attribute?.value) return false;
  const staticStringValue = getStringLiteralAttributeValue(attribute);
  if (staticStringValue !== null) {
    return (
      staticStringValue.trim().length > 0 &&
      (!hasOnlyKnownTailwindBoxClasses(node) || hasAmbiguousBoxSizingClasses(node))
    );
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    return expression.value !== null && typeof expression.value !== "boolean";
  }
  if (isLiteralVoidExpression(expression)) return false;
  if (
    isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression)
  ) {
    return false;
  }
  return true;
};

const stylePropertyMayReserveSpace = (
  property: EsTreeNodeOfType<"Property"> | null,
  propertyKind: "aspect-ratio" | "height" | "width",
  context: RuleContext,
): boolean => {
  if (!property) return false;
  const value = stripParenExpression(property.value);
  if (isNodeOfType(value, "Literal")) {
    if (typeof value.value === "number") return value.value > 0;
    if (typeof value.value !== "string") return false;
    const normalizedValue = value.value.trim().toLowerCase();
    if (!normalizedValue || normalizedValue === "auto" || normalizedValue === "none") return false;
    if (CSS_VALUE_FUNCTION_PATTERN.test(normalizedValue)) return true;
    if (propertyKind !== "aspect-ratio") {
      if (propertyKind === "height" && normalizedValue.endsWith("%")) return false;
      const lengthMatch = CSS_LENGTH_PATTERN.exec(normalizedValue);
      return Boolean(lengthMatch?.[1] && Number(lengthMatch[1]) > 0);
    }
    const ratioValue = normalizedValue.replace(/^auto\s+/, "");
    const ratioParts = ratioValue.split("/").map((part) => part.trim());
    return (
      ratioParts.length <= 2 &&
      ratioParts.every((part) => Number.isFinite(Number(part)) && Number(part) > 0)
    );
  }
  if (
    isNodeOfType(value, "UnaryExpression") &&
    (value.operator === "+" || value.operator === "-")
  ) {
    const argument = stripParenExpression(value.argument);
    if (isNodeOfType(argument, "Literal") && typeof argument.value === "number") {
      const numericValue = value.operator === "-" ? -argument.value : argument.value;
      return Number.isFinite(numericValue) && numericValue > 0;
    }
    if (
      isNodeOfType(argument, "Identifier") &&
      context.scopes.isGlobalReference(argument) &&
      (argument.name === "undefined" || argument.name === "NaN" || argument.name === "Infinity")
    ) {
      return false;
    }
  }
  if (isLiteralVoidExpression(value)) return false;
  if (
    isNodeOfType(value, "Identifier") &&
    context.scopes.isGlobalReference(value) &&
    (value.name === "undefined" || value.name === "NaN" || value.name === "Infinity")
  ) {
    return false;
  }
  return true;
};

const dimensionAttributeMayReserveSpace = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  context: RuleContext,
): boolean => {
  if (!attribute.value) return false;
  const staticStringValue = getStringLiteralAttributeValue(attribute);
  if (staticStringValue !== null) {
    return /^\s*\d+\s*$/.test(staticStringValue) && Number(staticStringValue) > 0;
  }
  if (!isNodeOfType(attribute.value, "JSXExpressionContainer")) return true;
  const expression = stripParenExpression(attribute.value.expression);
  if (isNodeOfType(expression, "Literal")) {
    return (
      typeof expression.value === "number" &&
      Number.isFinite(expression.value) &&
      expression.value > 0
    );
  }
  if (
    isNodeOfType(expression, "UnaryExpression") &&
    (expression.operator === "+" || expression.operator === "-")
  ) {
    const argument = stripParenExpression(expression.argument);
    if (isNodeOfType(argument, "Literal") && typeof argument.value === "number") {
      const numericValue = expression.operator === "-" ? -argument.value : argument.value;
      return Number.isFinite(numericValue) && numericValue > 0;
    }
    if (
      isNodeOfType(argument, "Identifier") &&
      context.scopes.isGlobalReference(argument) &&
      (argument.name === "undefined" || argument.name === "NaN" || argument.name === "Infinity")
    ) {
      return false;
    }
  }
  if (isLiteralVoidExpression(expression)) return false;
  if (
    isNodeOfType(expression, "Identifier") &&
    context.scopes.isGlobalReference(expression) &&
    (expression.name === "undefined" || expression.name === "NaN" || expression.name === "Infinity")
  ) {
    return false;
  }
  return true;
};

const getReservedInlineBoxEvidence = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): ReservedImageBoxEvidence => {
  const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style", false);
  const expression = styleAttribute
    ? getInlineStyleExpression(styleAttribute, context.scopes)
    : null;
  if (!expression) return { hasAspectRatio: false, hasHeight: false, hasWidth: false };
  return {
    hasAspectRatio: stylePropertyMayReserveSpace(
      getEffectiveStyleProperty(expression.properties, "aspectRatio"),
      "aspect-ratio",
      context,
    ),
    hasWidth: stylePropertyMayReserveSpace(
      getEffectiveStyleProperty(expression.properties, "width"),
      "width",
      context,
    ),
    hasHeight: stylePropertyMayReserveSpace(
      getEffectiveStyleProperty(expression.properties, "height"),
      "height",
      context,
    ),
  };
};

const hasReservedInlineBox = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  hasImplicitWidth = false,
): boolean => evidenceReservesBox(getReservedInlineBoxEvidence(node, context), hasImplicitWidth);

const hasReservedImageBox = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  hasTailwind: boolean,
): boolean => {
  const widthAttribute = getAuthoritativeJsxAttribute(node.attributes, "width", false);
  const heightAttribute = getAuthoritativeJsxAttribute(node.attributes, "height", false);
  const classEvidence = hasTailwind
    ? getReservedClassBoxEvidence(node)
    : { hasAspectRatio: false, hasHeight: false, hasWidth: false };
  const inlineEvidence = getReservedInlineBoxEvidence(node, context);
  const className = hasTailwind ? getStaticClassName(node) : null;
  const classNameTokens = className
    ? getUnvariantClassNameTokensWithImportantModifiers(className)
    : [];
  const aspectRatioResolution = resolveEffectiveTailwindClassNameToken(classNameTokens, (utility) =>
    utility.startsWith("aspect-"),
  );
  const widthResolution = resolveEffectiveTailwindClassNameToken(
    classNameTokens,
    (utility) => utility.startsWith("size-") || utility.startsWith("w-"),
  );
  const heightResolution = resolveEffectiveTailwindClassNameToken(
    classNameTokens,
    (utility) => utility.startsWith("size-") || utility.startsWith("h-"),
  );
  return evidenceReservesBox(
    {
      hasAspectRatio:
        classEvidence.hasAspectRatio ||
        (!aspectRatioResolution.isImportant && inlineEvidence.hasAspectRatio),
      hasWidth:
        classEvidence.hasWidth ||
        (!widthResolution.isImportant && inlineEvidence.hasWidth) ||
        Boolean(widthAttribute && dimensionAttributeMayReserveSpace(widthAttribute, context)),
      hasHeight:
        classEvidence.hasHeight ||
        (!heightResolution.isImportant && inlineEvidence.hasHeight) ||
        Boolean(heightAttribute && dimensionAttributeMayReserveSpace(heightAttribute, context)),
    },
    false,
  );
};

const isStaticallyNonRenderedImage = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  hasTailwind: boolean,
): boolean => {
  const hiddenAttribute = getAuthoritativeJsxAttribute(node.attributes, "hidden", false);
  if (hiddenAttribute) {
    if (!hiddenAttribute.value) return true;
    if (isNodeOfType(hiddenAttribute.value, "Literal")) return true;
    if (isNodeOfType(hiddenAttribute.value, "JSXExpressionContainer")) {
      const hiddenExpression = stripParenExpression(hiddenAttribute.value.expression);
      if (isNodeOfType(hiddenExpression, "Literal") && Boolean(hiddenExpression.value)) return true;
    }
  }
  if (hasTailwind) {
    const className = getStaticClassName(node);
    if (className && hasOnlyKnownTailwindBoxClasses(node)) {
      const tokens = splitTailwindClassName(className);
      const parsedDisplayTokens = tokens
        .map(parseTailwindClassNameToken)
        .filter((token) => TAILWIND_DISPLAY_TOKENS.has(token.utility));
      const targetVariantScopes = [
        [],
        ...parsedDisplayTokens
          .filter((token) => token.variants.length > 0)
          .map((token) => token.variants),
      ];
      const isHiddenAtEveryDisplayScope =
        targetVariantScopes.length > 0 &&
        targetVariantScopes.every(
          (targetVariantScope) =>
            getEffectiveTailwindClassNameToken(
              tokens,
              (utility) => TAILWIND_DISPLAY_TOKENS.has(utility),
              targetVariantScope,
            ) === "hidden",
        );
      if (isHiddenAtEveryDisplayScope) return true;
    }
  }
  const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style", false);
  const expression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
  if (!expression) return false;
  const displayProperty = getEffectiveStyleProperty(expression.properties, "display");
  const displayValue = displayProperty ? getStylePropertyStringValue(displayProperty) : null;
  return displayValue?.toLowerCase() === "none";
};

const hasUnresolvedInlineBox = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style", false);
  if (!styleAttribute) return false;
  const expression = getInlineStyleExpression(styleAttribute);
  if (!expression) return true;
  return expression.properties.some((property) => getStylePropertyKey(property) === null);
};

const hasReservedParentBox = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  hasTailwind: boolean,
): boolean => {
  const element = node.parent;
  const parentElement = element?.parent;
  if (
    !isNodeOfType(element, "JSXElement") ||
    !isNodeOfType(parentElement, "JSXElement") ||
    hasJsxSpreadAttribute(parentElement.openingElement.attributes)
  ) {
    return false;
  }
  const parentOpeningElement = parentElement.openingElement;
  const parentName = parentElement.openingElement.name;
  let parentHasImplicitWidth =
    isNodeOfType(parentName, "JSXIdentifier") &&
    IMPLICIT_WIDTH_PARENT_ELEMENT_NAMES.has(parentName.name);
  const parentStyleAttribute = getAuthoritativeJsxAttribute(
    parentOpeningElement.attributes,
    "style",
    false,
  );
  const parentStyleExpression = parentStyleAttribute
    ? getInlineStyleExpression(parentStyleAttribute)
    : null;
  if (parentStyleExpression) {
    const displayProperty = getEffectiveStyleProperty(parentStyleExpression.properties, "display");
    const positionProperty = getEffectiveStyleProperty(
      parentStyleExpression.properties,
      "position",
    );
    const floatProperty = getEffectiveStyleProperty(parentStyleExpression.properties, "float");
    const displayValue = displayProperty
      ? getStylePropertyStringValue(displayProperty)?.toLowerCase()
      : null;
    const positionValue = positionProperty
      ? getStylePropertyStringValue(positionProperty)?.toLowerCase()
      : null;
    const floatValue = floatProperty
      ? getStylePropertyStringValue(floatProperty)?.toLowerCase()
      : null;
    if (displayValue) {
      parentHasImplicitWidth = /^(?:block|flex|flow-root|grid|list-item)$/.test(displayValue);
    }
    if (
      positionValue === "absolute" ||
      positionValue === "fixed" ||
      (floatValue !== null && floatValue !== "none")
    ) {
      parentHasImplicitWidth = false;
    }
  }
  if (hasTailwind) {
    const parentClassName = getStaticClassName(parentOpeningElement);
    const parentTokens = parentClassName
      ? getUnvariantClassNameTokensWithImportantModifiers(parentClassName)
      : [];
    const effectiveDisplay = getEffectiveTailwindClassNameToken(parentTokens, (utility) =>
      TAILWIND_DISPLAY_TOKENS.has(utility),
    );
    const effectivePosition = getEffectiveTailwindClassNameToken(parentTokens, (utility) =>
      /^(?:static|fixed|absolute|relative|sticky)$/.test(utility),
    );
    const effectiveFloat = getEffectiveTailwindClassNameToken(parentTokens, (utility) =>
      /^(?:float-(?:start|end|right|left|none))$/.test(utility),
    );
    if (effectiveDisplay) {
      parentHasImplicitWidth = /^(?:block|flex|flow-root|grid|list-item)$/.test(effectiveDisplay);
    }
    if (
      effectivePosition === "absolute" ||
      effectivePosition === "fixed" ||
      (effectiveFloat !== null && effectiveFloat !== "float-none")
    ) {
      parentHasImplicitWidth = false;
    }
  }
  return Boolean(
    (hasTailwind && hasReservedClassBox(parentOpeningElement, parentHasImplicitWidth)) ||
    hasReservedInlineBox(parentOpeningElement, context, parentHasImplicitWidth),
  );
};

const hasUnresolvedParentBox = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
  hasTailwind: boolean,
): boolean => {
  const element = node.parent;
  const parentElement = element?.parent;
  if (!isNodeOfType(element, "JSXElement") || !isNodeOfType(parentElement, "JSXElement")) {
    return false;
  }
  if (!hasTailwind && getStaticClassName(parentElement.openingElement)) return true;
  return (
    hasJsxSpreadAttribute(parentElement.openingElement.attributes) ||
    classNameMayProvideExternalBox(parentElement.openingElement, context) ||
    hasUnresolvedInlineBox(parentElement.openingElement)
  );
};

export const noImgWithoutDimensions = defineRule({
  id: "no-img-without-dimensions",
  title: "Image has no reserved layout space",
  severity: "warn",
  category: "Performance",
  defaultEnabled: false,
  recommendation:
    "Add width and height attributes, or reserve the image's aspect ratio with an explicit CSS box before it loads.",
  create: (context: RuleContext) => {
    const staticCssStyleResolver = createStaticCssStyleResolver(context.filename);
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        if (
          resolveJsxElementType(node) !== "img" ||
          hasJsxSpreadAttribute(node.attributes) ||
          isGeneratedImageRenderContext(context, node)
        ) {
          return;
        }
        const hasTailwind = hasCapabilityOrUnspecified(context.settings, "tailwind");
        if (isStaticallyNonRenderedImage(node, hasTailwind)) return;
        if (!hasTailwind && getStaticClassName(node)) return;
        if (
          hasReservedImageBox(node, context, hasTailwind) ||
          hasReservedParentBox(node, context, hasTailwind) ||
          hasReservedExternalCssBox(node, context, staticCssStyleResolver)
        ) {
          return;
        }
        if (
          classNameMayProvideExternalBox(node, context) ||
          hasUnresolvedInlineBox(node) ||
          hasUnresolvedParentBox(node, context, hasTailwind)
        ) {
          return;
        }
        context.report({
          node,
          message:
            "This image reserves no dimensions or aspect ratio before loading, so surrounding content can shift. Add width and height or an explicit aspect-ratio box.",
        });
      },
    };
  },
});
