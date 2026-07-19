import {
  MIN_BOUNDED_CONTAINER_PADDING_PX,
  ROOT_FONT_SIZE_PX,
  TAILWIND_SPACING_UNIT_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { hasVisibleTailwindClosedSurface } from "./utils/has-visible-tailwind-fill-or-edge.js";
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
const BOUNDED_CONTAINER_TAG_NAMES = new Set([
  "article",
  "aside",
  "div",
  "fieldset",
  "footer",
  "header",
  "li",
  "main",
  "nav",
  "p",
  "section",
]);

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
  defaultEnabled: false,
  category: "Accessibility",
  recommendation: "Give text at least 8px of space inside a visible border or colored surface.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!getStaticJsxText(node).trim()) return;
      const openingElement = node.openingElement;
      if (!BOUNDED_CONTAINER_TAG_NAMES.has(resolveJsxElementType(openingElement))) return;
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (classNameValue) {
        const tokens = getUnvariantClassNameTokens(classNameValue);
        const paddingPx = getTailwindPaddingPx(tokens);
        if (
          hasVisibleTailwindClosedSurface(tokens) &&
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
        const hasBoundary = [...BOUNDARY_STYLE_PROPERTIES].some((propertyName) => {
          const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
          return property !== null && isVisibleInlineBoundary(property);
        });
        if (!hasBoundary) continue;
        for (const propertyName of PADDING_STYLE_PROPERTIES) {
          const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
          if (!property) continue;
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
