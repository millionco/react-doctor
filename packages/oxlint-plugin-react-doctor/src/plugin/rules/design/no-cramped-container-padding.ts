import {
  MIN_BOUNDED_CONTAINER_PADDING_PX,
  ROOT_FONT_SIZE_PX,
  TAILWIND_SPACING_UNIT_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const BOUNDARY_STYLE_PROPERTIES = new Set([
  "background",
  "backgroundColor",
  "border",
  "borderWidth",
  "boxShadow",
  "outline",
]);
const PADDING_STYLE_PROPERTIES = new Set([
  "padding",
  "paddingBlock",
  "paddingInline",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
]);
const TAILWIND_PADDING_PATTERN = /^(p[trblesxy]?)-(px|[\d.]+)$/;
const ARBITRARY_PADDING_PATTERN = /^(p[trblesxy]?)-\[([\d.]+)(px|rem)\]$/;
const TAILWIND_BORDER_WIDTH_PATTERN = /^border(?:-[trblxy])?(?:-([\d.]+|\[[\d.]+px\]))?$/;
const TAILWIND_RING_WIDTH_PATTERN = /^ring(?:-([\d.]+|\[[\d.]+px\]))?$/;
const NON_SURFACE_BACKGROUND_PATTERN =
  /^bg-(?:auto|center|clip-|contain|cover|fixed|left|local|none|origin-|repeat|right|scroll|top|transparent|\[(?:length|position|size):)/;
const TRANSPARENT_BORDER_PATTERN =
  /^(?:border(?:-[trblxy])?-(?:opacity-0|transparent)|border(?:-[trblxy])?-.+\/0)$/;
const TRANSPARENT_RING_PATTERN = /^(?:ring-(?:opacity-0|transparent)|ring-.+\/0)$/;
const TRANSPARENT_BACKGROUND_PATTERN = /^(?:bg-opacity-0|bg-(?:\[transparent\]|.+\/0))$/;

const getPaddingPx = (property: EsTreeNode): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property)?.trim();
  if (!stringValue) return null;
  const match = stringValue.match(/^([\d.]+)(px|rem)$/);
  if (!match) return null;
  const value = parseFloat(match[1]);
  return match[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
};

const hasPositiveWidth = (token: string, pattern: RegExp): boolean => {
  const match = token.match(pattern);
  if (!match) return false;
  if (!match[1]) return true;
  return parseFloat(match[1].replace(/^\[|px\]$/g, "")) > 0;
};

const hasTailwindBoundary = (tokens: string[]): boolean => {
  const hasVisibleBorder =
    !tokens.some((token) => TRANSPARENT_BORDER_PATTERN.test(token)) &&
    tokens.some((token) => hasPositiveWidth(token, TAILWIND_BORDER_WIDTH_PATTERN));
  const hasVisibleRing =
    !tokens.some((token) => TRANSPARENT_RING_PATTERN.test(token)) &&
    tokens.some((token) => hasPositiveWidth(token, TAILWIND_RING_WIDTH_PATTERN));
  const hasVisibleBackground =
    !tokens.some((token) => TRANSPARENT_BACKGROUND_PATTERN.test(token)) &&
    tokens.some((token) => token.startsWith("bg-") && !NON_SURFACE_BACKGROUND_PATTERN.test(token));
  return hasVisibleBorder || hasVisibleRing || hasVisibleBackground;
};

const isVisibleInlineBoundary = (property: EsTreeNode): boolean => {
  const propertyName = getStylePropertyKey(property);
  if (!propertyName || !BOUNDARY_STYLE_PROPERTIES.has(propertyName)) return false;
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue > 0;
  const propertyValue = getStylePropertyStringValue(property)?.trim().toLowerCase();
  if (!propertyValue) return false;
  return !/^(?:0(?:px|rem|em)?|none|transparent)$/.test(propertyValue);
};

const getTailwindPaddingPx = (tokens: string[]): number | null => {
  const paddingByAxis = new Map<string, number>();
  for (const token of tokens) {
    const spacingMatch = token.match(TAILWIND_PADDING_PATTERN);
    if (spacingMatch) {
      paddingByAxis.set(
        spacingMatch[1],
        spacingMatch[2] === "px" ? 1 : parseFloat(spacingMatch[2]) * TAILWIND_SPACING_UNIT_PX,
      );
    }
    const arbitraryMatch = token.match(ARBITRARY_PADDING_PATTERN);
    if (arbitraryMatch) {
      const value = parseFloat(arbitraryMatch[2]);
      paddingByAxis.set(
        arbitraryMatch[1],
        arbitraryMatch[3] === "rem" ? value * ROOT_FONT_SIZE_PX : value,
      );
    }
  }
  const basePadding = paddingByAxis.get("p");
  const horizontalPadding = paddingByAxis.get("px") ?? basePadding;
  const verticalPadding = paddingByAxis.get("py") ?? basePadding;
  const effectivePadding = [
    paddingByAxis.get("pt") ?? verticalPadding,
    paddingByAxis.get("pr") ?? horizontalPadding,
    paddingByAxis.get("pb") ?? verticalPadding,
    paddingByAxis.get("pl") ?? horizontalPadding,
    paddingByAxis.get("ps"),
    paddingByAxis.get("pe"),
  ].filter((padding): padding is number => padding !== undefined);
  return effectivePadding.length > 0 ? Math.min(...effectivePadding) : null;
};

export const noCrampedContainerPadding = defineRule({
  id: "no-cramped-container-padding",
  title: "Bounded text container has cramped padding",
  severity: "warn",
  tags: ["design", "test-noise"],
  category: "Accessibility",
  recommendation: "Give text at least 8px of space inside a visible border or colored surface.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!getStaticJsxText(node).trim()) return;
      const openingElement = node.openingElement;
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (classNameValue) {
        const tokens = getUnvariantClassNameTokens(classNameValue);
        const paddingPx = getTailwindPaddingPx(tokens);
        if (
          hasTailwindBoundary(tokens) &&
          paddingPx !== null &&
          paddingPx < MIN_BOUNDED_CONTAINER_PADDING_PX
        ) {
          context.report({
            node: openingElement,
            message: `This visible container leaves only ${paddingPx}px around its text. Use at least ${MIN_BOUNDED_CONTAINER_PADDING_PX}px of padding.`,
          });
          return;
        }
      }

      for (const attribute of openingElement.attributes ?? []) {
        if (!isNodeOfType(attribute, "JSXAttribute")) continue;
        const styleExpression = getInlineStyleExpression(attribute);
        if (!styleExpression) continue;
        const hasBoundary = styleExpression.properties?.some(isVisibleInlineBoundary);
        if (!hasBoundary) continue;
        for (const property of styleExpression.properties ?? []) {
          const propertyName = getStylePropertyKey(property);
          if (!propertyName || !PADDING_STYLE_PROPERTIES.has(propertyName)) continue;
          const paddingPx = getPaddingPx(property);
          if (paddingPx === null || paddingPx >= MIN_BOUNDED_CONTAINER_PADDING_PX) continue;
          context.report({
            node: property,
            message: `This bounded surface gives its text ${paddingPx}px of padding. Increase it to at least ${MIN_BOUNDED_CONTAINER_PADDING_PX}px.`,
          });
        }
      }
    },
  }),
});
