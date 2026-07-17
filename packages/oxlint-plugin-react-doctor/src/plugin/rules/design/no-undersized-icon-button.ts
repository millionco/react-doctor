import { MINIMUM_TARGET_SIZE_PX, TAILWIND_SPACING_UNIT_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";

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

const getTailwindTargetSize = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): [number, number] | null => {
  const className = getStringFromClassNameAttr(node);
  if (!className) return null;
  if (/(?:^|\s)(?:before|after):/.test(className)) return null;
  const tokens = getUnvariantClassNameTokens(className);
  if (!tokens.includes("p-0") && !(tokens.includes("px-0") && tokens.includes("py-0"))) {
    return null;
  }
  if (tokens.some((token) => token.startsWith("min-w-") || token.startsWith("min-h-"))) {
    return null;
  }
  let width: number | null = null;
  let height: number | null = null;
  for (const token of tokens) {
    const size = parseTailwindLength(token, "size");
    if (size !== null) {
      width = size;
      height = size;
      continue;
    }
    const currentWidth = parseTailwindLength(token, "w");
    if (currentWidth !== null) width = currentWidth;
    const currentHeight = parseTailwindLength(token, "h");
    if (currentHeight !== null) height = currentHeight;
  }
  return width !== null && height !== null ? [width, height] : null;
};

const getInlineTargetSize = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): [number, number] | null => {
  const styleAttribute = findJsxAttribute(node.attributes, "style");
  const expression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
  if (!expression) return null;
  const widthProperty = getEffectiveStyleProperty(expression.properties, "width");
  const heightProperty = getEffectiveStyleProperty(expression.properties, "height");
  const paddingProperty = getEffectiveStyleProperty(expression.properties, "padding");
  if (!widthProperty || !heightProperty || !paddingProperty) return null;
  const width = getStylePropertyNumberValue(widthProperty);
  const height = getStylePropertyNumberValue(heightProperty);
  const padding = getStylePropertyNumberValue(paddingProperty);
  return width !== null && height !== null && padding === 0 ? [width, height] : null;
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
      const targetSize =
        getInlineTargetSize(node.openingElement) ?? getTailwindTargetSize(node.openingElement);
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
