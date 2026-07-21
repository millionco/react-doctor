import { MINIMUM_TARGET_SIZE_PX, TAILWIND_SPACING_UNIT_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";

interface InlineTargetSizeResult {
  hasTargetStyle: boolean;
  targetSize: [number, number] | null;
}

const isIconOnlyButton = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  let iconCount = 0;
  for (const child of node.children) {
    if (isNodeOfType(child, "JSXText") && child.value.trim().length === 0) continue;
    if (isNodeOfType(child, "JSXElement")) {
      iconCount += 1;
      continue;
    }
    return false;
  }
  return iconCount === 1;
};

const parseTailwindLength = (token: string, prefix: string): number | null => {
  const arbitraryMatch = token.match(new RegExp(`^${prefix}-\\[([\\d.]+)px\\]$`));
  if (arbitraryMatch) return Number.parseFloat(arbitraryMatch[1]);
  const scaleMatch = token.match(new RegExp(`^${prefix}-([\\d.]+)$`));
  return scaleMatch ? Number.parseFloat(scaleMatch[1]) * TAILWIND_SPACING_UNIT_PX : null;
};

const WIDTH_UTILITY_PATTERN = /^(?:size|w)-/;
const HEIGHT_UTILITY_PATTERN = /^(?:h|size)-/;
const HORIZONTAL_PADDING_UTILITY_PATTERN = /^p(?:[xlr])?-/;
const VERTICAL_PADDING_UTILITY_PATTERN = /^p(?:[ytb])?-/;

const isZeroHorizontalPaddingUtility = (utility: string): boolean =>
  utility === "p-0" || utility === "px-0";

const isZeroVerticalPaddingUtility = (utility: string): boolean =>
  utility === "p-0" || utility === "py-0";

const hasImportantTargetUtility = (tokens: string[]): boolean =>
  tokens.some((token) => {
    if (!token.startsWith("!")) return false;
    const utility = token.slice(1);
    return (
      WIDTH_UTILITY_PATTERN.test(utility) ||
      HEIGHT_UTILITY_PATTERN.test(utility) ||
      HORIZONTAL_PADDING_UTILITY_PATTERN.test(utility) ||
      VERTICAL_PADDING_UTILITY_PATTERN.test(utility)
    );
  });

const hasPseudoElementVariant = (className: string): boolean =>
  splitTailwindClassName(className).some((token) =>
    parseTailwindClassNameToken(token).variants.some(
      (variant) => variant === "before" || variant === "after",
    ),
  );

const getTailwindTargetSize = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): [number, number] | null => {
  const className = getStringFromClassNameAttr(node);
  if (!className) return null;
  if (hasPseudoElementVariant(className)) return null;
  const tokens = getUnvariantClassNameTokensWithImportantModifiers(className);
  const effectiveHorizontalPadding = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    HORIZONTAL_PADDING_UTILITY_PATTERN.test(utility),
  );
  const effectiveVerticalPadding = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    VERTICAL_PADDING_UTILITY_PATTERN.test(utility),
  );
  if (
    !effectiveHorizontalPadding ||
    !effectiveVerticalPadding ||
    !isZeroHorizontalPaddingUtility(effectiveHorizontalPadding) ||
    !isZeroVerticalPaddingUtility(effectiveVerticalPadding)
  ) {
    return null;
  }
  if (
    tokens.some((token) => {
      const utility = token.startsWith("!") ? token.slice(1) : token;
      return utility.startsWith("min-w-") || utility.startsWith("min-h-");
    })
  ) {
    return null;
  }
  const effectiveWidth = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    WIDTH_UTILITY_PATTERN.test(utility),
  );
  const effectiveHeight = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    HEIGHT_UTILITY_PATTERN.test(utility),
  );
  const width = effectiveWidth
    ? (parseTailwindLength(effectiveWidth, "size") ?? parseTailwindLength(effectiveWidth, "w"))
    : null;
  const height = effectiveHeight
    ? (parseTailwindLength(effectiveHeight, "size") ?? parseTailwindLength(effectiveHeight, "h"))
    : null;
  return width !== null && height !== null ? [width, height] : null;
};

const getInlineTargetSize = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): InlineTargetSizeResult => {
  const styleAttribute = getAuthoritativeJsxAttribute(node.attributes, "style");
  if (!styleAttribute) return { hasTargetStyle: false, targetSize: null };
  const expression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
  if (!expression) return { hasTargetStyle: true, targetSize: null };
  const widthProperty = getEffectiveStyleProperty(expression.properties, "width");
  const heightProperty = getEffectiveStyleProperty(expression.properties, "height");
  const paddingProperty = getEffectiveStyleProperty(expression.properties, "padding");
  const hasTargetStyle = Boolean(widthProperty || heightProperty || paddingProperty);
  if (!hasTargetStyle) {
    return {
      hasTargetStyle: expression.properties.some(
        (property) => getStylePropertyKey(property) === null,
      ),
      targetSize: null,
    };
  }
  if (!widthProperty || !heightProperty || !paddingProperty) {
    return { hasTargetStyle: true, targetSize: null };
  }
  const width = getStylePropertyNumberValue(widthProperty);
  const height = getStylePropertyNumberValue(heightProperty);
  const padding = getStylePropertyNumberValue(paddingProperty);
  return {
    hasTargetStyle: true,
    targetSize: width !== null && height !== null && padding === 0 ? [width, height] : null,
  };
};

export const noUndersizedIconButton = defineRule({
  id: "no-undersized-icon-button",
  title: "Icon button target is smaller than 24px",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Make the button at least 24 by 24 CSS pixels, or provide enough surrounding target spacing to satisfy the WCAG exception.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        resolveJsxElementType(node.openingElement) !== "button" ||
        hasJsxSpreadAttribute(node.openingElement.attributes) ||
        !isIconOnlyButton(node)
      ) {
        return;
      }
      const className = getStringFromClassNameAttr(node.openingElement);
      const tailwindTokens = className
        ? getUnvariantClassNameTokensWithImportantModifiers(className)
        : [];
      const inlineTargetSizeResult = getInlineTargetSize(node.openingElement);
      const targetSize = inlineTargetSizeResult.hasTargetStyle
        ? inlineTargetSizeResult.targetSize && !hasImportantTargetUtility(tailwindTokens)
          ? inlineTargetSizeResult.targetSize
          : null
        : hasCapabilityOrUnspecified(context.settings, "tailwind")
          ? getTailwindTargetSize(node.openingElement)
          : null;
      if (
        !targetSize ||
        (targetSize[0] >= MINIMUM_TARGET_SIZE_PX && targetSize[1] >= MINIMUM_TARGET_SIZE_PX)
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message: `This icon-only button is explicitly ${targetSize[0]}×${targetSize[1]}px with no padding, below the ${MINIMUM_TARGET_SIZE_PX}×${MINIMUM_TARGET_SIZE_PX}px minimum target. Enlarge its hit area.`,
      });
    },
  }),
});
