import { SVG_TAGS } from "../../constants/svg-tags.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticStringExpression } from "../../utils/get-static-string-expression.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getTailwindVisibilityAtBreakpoints } from "../../utils/get-tailwind-visibility-at-breakpoints.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import {
  SHAPE_ASSEMBLED_ILLUSTRATION_MAXIMUM_TEXT_ELEMENT_COUNT,
  SHAPE_ASSEMBLED_ILLUSTRATION_MINIMUM_DISTINCT_FILL_COUNT,
  SHAPE_ASSEMBLED_ILLUSTRATION_MINIMUM_PRIMITIVE_COUNT,
  SHAPE_ASSEMBLED_ILLUSTRATION_MINIMUM_SIZE_PX,
} from "./utils/constants.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { parseColorToRgb } from "./utils/parse-color-to-rgb.js";
import { parseStaticCssColorWithAlpha } from "./utils/parse-static-css-color-with-alpha.js";

const PRIMITIVE_ELEMENT_NAMES = new Set(["rect", "circle", "ellipse", "polygon"]);
const TEXT_ELEMENT_NAMES = new Set(["text", "tspan"]);
const EXCLUDED_SUBTREE_ELEMENT_NAMES = new Set(["defs", "symbol", "mask", "clipPath"]);
const TAILWIND_DIMENSION_UTILITY_PATTERN =
  /^(?:(?:size|w|h|max-w|max-h)-|\[(?:width|height|max-width|max-height):)/;

interface SvgIllustrationEvidence {
  hasPattern: boolean;
  primitiveFillKeys: string[];
  visibleTextElementCount: number;
}

const getIntrinsicElementName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null =>
  isNodeOfType(openingElement.name, "JSXIdentifier") ? openingElement.name.name : null;

const getStrictStaticNumericValue = (value: EsTreeNode | null | undefined): number | null => {
  if (!value) return null;
  let candidate = value;
  if (isNodeOfType(candidate, "JSXExpressionContainer")) {
    candidate = stripParenExpression(candidate.expression);
  }
  if (!isNodeOfType(candidate, "Literal")) return null;
  if (typeof candidate.value === "number") {
    return Number.isFinite(candidate.value) ? candidate.value : null;
  }
  if (typeof candidate.value !== "string") return null;
  const normalizedValue = candidate.value.trim().toLowerCase();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?(?:px)?$/.test(normalizedValue)) return null;
  const parsedValue = Number(normalizedValue.replace(/px$/, ""));
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const getStrictStaticStringAttributeValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): string | null => {
  const directValue = getStringLiteralAttributeValue(attribute);
  if (directValue !== null) return directValue;
  return isNodeOfType(attribute.value, "JSXExpressionContainer")
    ? getStaticStringExpression(attribute.value.expression)
    : null;
};

const getStaticSvgDimensions = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): readonly [number, number] | null => {
  if (
    openingElement.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
  ) {
    return null;
  }
  const widthAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "width");
  const heightAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "height");
  if (!widthAttribute || !heightAttribute) return null;
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  if (styleAttribute) {
    const styleExpression = getInlineStyleExpression(styleAttribute, context.scopes);
    if (
      !styleExpression ||
      getEffectiveStyleProperty(styleExpression.properties, "width") ||
      getEffectiveStyleProperty(styleExpression.properties, "height") ||
      getEffectiveStyleProperty(styleExpression.properties, "maxWidth") ||
      getEffectiveStyleProperty(styleExpression.properties, "maxHeight")
    ) {
      return null;
    }
  }
  const classNameAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "className");
  if (classNameAttribute) {
    const classNameValue = getStringFromClassNameAttr(openingElement);
    if (
      classNameValue === null ||
      splitTailwindClassName(classNameValue)
        .map(parseTailwindClassNameToken)
        .some(({ utility }) => TAILWIND_DIMENSION_UTILITY_PATTERN.test(utility))
    ) {
      return null;
    }
  }
  const width = getStrictStaticNumericValue(widthAttribute.value);
  const height = getStrictStaticNumericValue(heightAttribute.value);
  return width !== null && height !== null && width > 0 && height > 0 ? [width, height] : null;
};

const getCanonicalStaticPaintKey = (paint: string | null): string | null => {
  if (paint === null) return null;
  const normalizedPaint = paint.trim().toLowerCase();
  const parseablePaint =
    normalizedPaint === "white" ? "#fff" : normalizedPaint === "black" ? "#000" : normalizedPaint;
  const parsedColor = parseColorToRgb(parseablePaint);
  const parsedColorWithAlpha = parseStaticCssColorWithAlpha(parseablePaint);
  if (
    !parsedColor ||
    !parsedColorWithAlpha ||
    parsedColorWithAlpha.alpha <= 0 ||
    Object.values(parsedColor).some(
      (channel) => !Number.isInteger(channel) || channel < 0 || channel > 255,
    )
  ) {
    return null;
  }
  return `${parsedColor.red},${parsedColor.green},${parsedColor.blue}`;
};

const getStaticOwnFill = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): string | null => {
  if (
    openingElement.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
  ) {
    return null;
  }
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  if (styleAttribute) {
    const styleExpression = getInlineStyleExpression(styleAttribute, context.scopes);
    if (!styleExpression) return null;
    const fillProperty = getEffectiveStyleProperty(styleExpression.properties, "fill");
    if (fillProperty) {
      return getCanonicalStaticPaintKey(getStylePropertyStringValue(fillProperty));
    }
    if (
      styleExpression.properties.some(
        (property) => !isNodeOfType(property, "Property") || getStylePropertyKey(property) === null,
      )
    ) {
      return null;
    }
  }
  const fillAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "fill");
  return fillAttribute
    ? getCanonicalStaticPaintKey(getStrictStaticStringAttributeValue(fillAttribute))
    : null;
};

const getStaticBooleanAttributeState = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean | null => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute) return false;
  if (!attribute.value) return true;
  const value = attribute.value;
  if (isNodeOfType(value, "Literal")) return value.value !== false && value.value !== null;
  if (!isNodeOfType(value, "JSXExpressionContainer")) return null;
  const expression = stripParenExpression(value.expression);
  return isNodeOfType(expression, "Literal")
    ? expression.value !== false && expression.value !== null
    : null;
};

const getStaticPresentationAttributeValue = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): string | null | undefined => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute) return undefined;
  return getStrictStaticStringAttributeValue(attribute);
};

const getStaticStyleNumberValue = (property: EsTreeNodeOfType<"Property">): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property);
  if (stringValue === null || stringValue.trim() === "") return null;
  const parsedValue = Number(stringValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
};

const getStaticRenderingState = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): "hidden" | "unknown" | "visible" => {
  if (
    openingElement.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute"))
  ) {
    return "unknown";
  }
  const hiddenState = getStaticBooleanAttributeState(openingElement, "hidden");
  if (hiddenState === null) return "unknown";
  if (hiddenState) return "hidden";

  const displayValue = getStaticPresentationAttributeValue(openingElement, "display");
  const visibilityValue = getStaticPresentationAttributeValue(openingElement, "visibility");
  const opacityAttribute = getAuthoritativeJsxAttribute(
    openingElement.attributes,
    "opacity",
    false,
  );
  const opacityValue = opacityAttribute
    ? getStrictStaticNumericValue(opacityAttribute.value)
    : undefined;
  if (displayValue === null || visibilityValue === null || opacityValue === null) return "unknown";
  if (
    displayValue?.trim().toLowerCase() === "none" ||
    ["hidden", "collapse"].includes(visibilityValue?.trim().toLowerCase() ?? "") ||
    opacityValue === 0
  ) {
    return "hidden";
  }

  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  if (styleAttribute) {
    const styleExpression = getInlineStyleExpression(styleAttribute, context.scopes);
    if (
      !styleExpression ||
      styleExpression.properties.some(
        (property) => !isNodeOfType(property, "Property") || getStylePropertyKey(property) === null,
      )
    ) {
      return "unknown";
    }
    const displayProperty = getEffectiveStyleProperty(styleExpression.properties, "display");
    const visibilityProperty = getEffectiveStyleProperty(styleExpression.properties, "visibility");
    const opacityProperty = getEffectiveStyleProperty(styleExpression.properties, "opacity");
    const styleDisplayValue = displayProperty
      ? getStylePropertyStringValue(displayProperty)
      : undefined;
    const styleVisibilityValue = visibilityProperty
      ? getStylePropertyStringValue(visibilityProperty)
      : undefined;
    const styleOpacityValue = opacityProperty
      ? getStaticStyleNumberValue(opacityProperty)
      : undefined;
    if (
      styleDisplayValue === null ||
      styleVisibilityValue === null ||
      (opacityProperty && !Number.isFinite(styleOpacityValue))
    ) {
      return "unknown";
    }
    if (
      styleDisplayValue?.trim().toLowerCase() === "none" ||
      ["hidden", "collapse"].includes(styleVisibilityValue?.trim().toLowerCase() ?? "") ||
      styleOpacityValue === 0
    ) {
      return "hidden";
    }
  }

  const classNameAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "className");
  if (classNameAttribute) {
    const classNameValue = getStringFromClassNameAttr(openingElement);
    if (classNameValue === null) return "unknown";
    const visibilityAtBreakpoints = getTailwindVisibilityAtBreakpoints(classNameValue);
    if (visibilityAtBreakpoints === null) return "unknown";
    if (visibilityAtBreakpoints.every((isVisible) => !isVisible)) return "hidden";
  }
  return "visible";
};

const isStaticallyEmptySvgExpression = (expression: EsTreeNode): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "JSXEmptyExpression")) return true;
  if (isNodeOfType(candidate, "Literal")) {
    return (
      candidate.value === null ||
      typeof candidate.value === "boolean" ||
      (typeof candidate.value === "string" && candidate.value.trim() === "")
    );
  }
  return (
    isNodeOfType(candidate, "TemplateLiteral") &&
    candidate.expressions.length === 0 &&
    (candidate.quasis[0]?.value.cooked ?? candidate.quasis[0]?.value.raw ?? "").trim() === ""
  );
};

const collectSvgIllustrationEvidence = (
  element: EsTreeNodeOfType<"JSXElement">,
  evidence: SvgIllustrationEvidence,
  context: RuleContext,
  isExcludedByAncestor = false,
): boolean => {
  const openingElement = element.openingElement;
  const elementName = getIntrinsicElementName(openingElement);
  if (!elementName || !SVG_TAGS.has(elementName)) return false;
  if (elementName === "pattern") evidence.hasPattern = true;

  const renderingState = getStaticRenderingState(openingElement, context);
  if (renderingState === "unknown") return false;
  const isExcluded =
    isExcludedByAncestor ||
    renderingState === "hidden" ||
    EXCLUDED_SUBTREE_ELEMENT_NAMES.has(elementName) ||
    elementName === "pattern";

  if (!isExcluded && TEXT_ELEMENT_NAMES.has(elementName)) {
    evidence.visibleTextElementCount += 1;
  }
  if (!isExcluded && PRIMITIVE_ELEMENT_NAMES.has(elementName)) {
    const fillKey = getStaticOwnFill(openingElement, context);
    if (fillKey) evidence.primitiveFillKeys.push(fillKey);
  }

  for (const child of element.children) {
    if (isNodeOfType(child, "JSXText")) continue;
    if (isNodeOfType(child, "JSXElement")) {
      if (!collectSvgIllustrationEvidence(child, evidence, context, isExcluded)) return false;
      continue;
    }
    if (isNodeOfType(child, "JSXExpressionContainer")) {
      if (!isStaticallyEmptySvgExpression(child.expression)) return false;
      continue;
    }
    return false;
  }
  return true;
};

export const noShapeAssembledIllustration = defineRule({
  id: "no-shape-assembled-illustration",
  title: "Large illustration is assembled from primitive shapes",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Replace the shape pile with deliberate artwork, a photograph, or a purpose-built graphic that supports the product story.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (getIntrinsicElementName(openingElement) !== "svg") return;
      const dimensions = getStaticSvgDimensions(openingElement, context);
      if (
        !dimensions ||
        dimensions[0] < SHAPE_ASSEMBLED_ILLUSTRATION_MINIMUM_SIZE_PX ||
        dimensions[1] < SHAPE_ASSEMBLED_ILLUSTRATION_MINIMUM_SIZE_PX
      ) {
        return;
      }

      const evidence: SvgIllustrationEvidence = {
        hasPattern: false,
        primitiveFillKeys: [],
        visibleTextElementCount: 0,
      };
      if (!collectSvgIllustrationEvidence(node, evidence, context) || evidence.hasPattern) return;
      if (
        evidence.visibleTextElementCount > SHAPE_ASSEMBLED_ILLUSTRATION_MAXIMUM_TEXT_ELEMENT_COUNT
      ) {
        return;
      }

      const primitiveCount = evidence.primitiveFillKeys.length;
      if (primitiveCount < SHAPE_ASSEMBLED_ILLUSTRATION_MINIMUM_PRIMITIVE_COUNT) return;

      const distinctFills = new Set(evidence.primitiveFillKeys);
      if (distinctFills.size < SHAPE_ASSEMBLED_ILLUSTRATION_MINIMUM_DISTINCT_FILL_COUNT) {
        return;
      }

      context.report({
        node: openingElement,
        message: `This ${Math.round(dimensions[0])}×${Math.round(dimensions[1])} SVG assembles a large illustration from ${primitiveCount} basic shapes and ${distinctFills.size} fills. Use deliberate artwork instead of placeholder clip art.`,
      });
    },
  }),
});
