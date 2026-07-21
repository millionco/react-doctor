import {
  MIN_BOUNDED_CONTAINER_PADDING_PX,
  ROOT_FONT_SIZE_PX,
  TAILWIND_PADDING_AXIS_SPECIFICITY_RANK,
  TAILWIND_PADDING_SHORTHAND_SPECIFICITY_RANK,
  TAILWIND_PADDING_SIDE_SPECIFICITY_RANK,
  TAILWIND_SPACING_UNIT_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getEffectiveStylePropertyAmong } from "./utils/get-effective-style-property-among.js";
import {
  hasVisibleTailwindBackground,
  hasVisibleTailwindClosedBorder,
  hasVisibleTailwindRing,
} from "./utils/has-visible-tailwind-fill-or-edge.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";

const BOUNDARY_STYLE_PROPERTIES = new Set([
  "background",
  "backgroundColor",
  "border",
  "borderColor",
  "borderStyle",
  "borderWidth",
  "boxShadow",
  "outline",
]);
const BACKGROUND_STYLE_PROPERTIES = new Set(["background", "backgroundColor"]);
const BORDER_STYLE_PROPERTIES = new Set(["border", "borderColor", "borderStyle", "borderWidth"]);
const PADDING_SIDES_BY_PROPERTY = new Map([
  ["padding", ["top", "right", "bottom", "left"]],
  ["paddingBlock", ["top", "bottom"]],
  ["paddingInline", ["right", "left"]],
  ["paddingTop", ["top"]],
  ["paddingRight", ["right"]],
  ["paddingBottom", ["bottom"]],
  ["paddingLeft", ["left"]],
]);
const PADDING_SIDES_BY_PREFIX = new Map([
  ["p", ["top", "right", "bottom", "left"]],
  ["px", ["right", "left"]],
  ["py", ["top", "bottom"]],
  ["pt", ["top"]],
  ["pr", ["right"]],
  ["pb", ["bottom"]],
  ["pl", ["left"]],
  ["ps", ["start"]],
  ["pe", ["end"]],
]);
const TAILWIND_PADDING_PATTERN = /^(p[trblesxy]?)-(px|[\d.]+)$/;
const ARBITRARY_PADDING_PATTERN = /^(p[trblesxy]?)-\[([\d.]+)(px|rem)\]$/;
const TAILWIND_BACKGROUND_COLOR_PATTERN =
  /^bg-(?!opacity-|auto$|center$|clip-|contain$|cover$|fixed$|left$|local$|none$|origin-|repeat|right$|scroll$|top$|\[(?:length|position|size):).+/;
const TAILWIND_BORDER_GEOMETRY_PATTERN =
  /^border(?:-[trblxy])?(?:(?:-(?:px|\d+(?:\.\d+)?|\[\d+(?:\.\d+)?px\]))|-(?:hidden|none|solid|dashed|dotted|double))?$/;
const TAILWIND_SHADOW_GEOMETRY_PATTERN =
  /^(?:ring(?:-(?:px|\d+(?:\.\d+)?|\[\d+(?:\.\d+)?px\]))?|shadow(?:-none|-(?:2xl|inner|lg|md|sm|xl|xs))?)$/;
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

interface EffectiveInlinePadding {
  coveredSideCount: number;
  paddingPx: number;
  property: EsTreeNodeOfType<"Property">;
}

interface EffectiveTailwindPadding {
  isImportant: boolean;
  paddingPx: number | null;
  specificity: number;
}

interface TailwindPaddingResolution {
  minimumImportantPaddingPx: number | null;
  minimumPaddingPx: number | null;
}

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
  if (propertyName === "border" && /^0(?:px|rem|em)?(?:\s|$)/.test(propertyValue)) return false;
  if (propertyName === "boxShadow") {
    const shadowParts = propertyValue.split(/\s+/);
    const color = shadowParts.at(-1);
    if (
      (color === "transparent" || color?.endsWith("/0")) &&
      shadowParts.slice(0, -1).every((part) => /^0(?:px|rem|em)?$/.test(part))
    ) {
      return false;
    }
  }
  return !/^(?:0(?:px|rem|em)?|none|transparent)$/.test(propertyValue);
};

const getEffectiveInlinePadding = (
  properties: ReadonlyArray<EsTreeNode> | undefined,
): EffectiveInlinePadding | null => {
  const paddingBySide = new Map<
    string,
    { paddingPx: number; property: EsTreeNodeOfType<"Property"> }
  >();
  for (const property of properties ?? []) {
    const propertyName = getStylePropertyKey(property);
    if (!propertyName) {
      paddingBySide.clear();
      continue;
    }
    const affectedSides = PADDING_SIDES_BY_PROPERTY.get(propertyName);
    if (!affectedSides || !isNodeOfType(property, "Property")) continue;
    const paddingPx = getPaddingPx(property);
    for (const sideName of affectedSides) {
      if (paddingPx === null) {
        paddingBySide.delete(sideName);
      } else {
        paddingBySide.set(sideName, { paddingPx, property });
      }
    }
  }
  const effectivePadding = [...paddingBySide.values()].sort(
    (leftPadding, rightPadding) => leftPadding.paddingPx - rightPadding.paddingPx,
  )[0];
  return effectivePadding
    ? {
        coveredSideCount: paddingBySide.size,
        paddingPx: effectivePadding.paddingPx,
        property: effectivePadding.property,
      }
    : null;
};

const hasVisibleInlineBorder = (
  properties: ReadonlyArray<EsTreeNode> | undefined,
  hasVisibleTailwindBorder: boolean,
): boolean => {
  let hasVisibleWidth = hasVisibleTailwindBorder;
  let hasVisibleStyle = hasVisibleTailwindBorder;
  let hasVisibleColor = hasVisibleTailwindBorder;
  for (const property of properties ?? []) {
    const propertyName = getStylePropertyKey(property);
    if (!propertyName || !BORDER_STYLE_PROPERTIES.has(propertyName)) continue;
    const isVisible = isVisibleInlineBoundary(property);
    if (propertyName === "border") {
      hasVisibleWidth = isVisible;
      hasVisibleStyle = isVisible;
      hasVisibleColor = isVisible;
    }
    if (propertyName === "borderWidth") hasVisibleWidth = isVisible;
    if (propertyName === "borderStyle") hasVisibleStyle = isVisible;
    if (propertyName === "borderColor") hasVisibleColor = isVisible;
  }
  return hasVisibleWidth && hasVisibleStyle && hasVisibleColor;
};

const getTailwindPaddingResolution = (tokens: string[]): TailwindPaddingResolution => {
  const paddingBySide = new Map<string, EffectiveTailwindPadding>();
  const setPadding = (prefix: string, paddingPx: number, isImportant: boolean): void => {
    let specificity = TAILWIND_PADDING_SIDE_SPECIFICITY_RANK;
    if (prefix === "p") {
      specificity = TAILWIND_PADDING_SHORTHAND_SPECIFICITY_RANK;
    } else if (prefix === "px" || prefix === "py") {
      specificity = TAILWIND_PADDING_AXIS_SPECIFICITY_RANK;
    }
    for (const side of PADDING_SIDES_BY_PREFIX.get(prefix) ?? []) {
      const currentPadding = paddingBySide.get(side);
      if (
        (currentPadding?.isImportant && !isImportant) ||
        (currentPadding?.isImportant === isImportant && currentPadding.specificity > specificity)
      ) {
        continue;
      }
      if (
        currentPadding?.isImportant === isImportant &&
        currentPadding.specificity === specificity
      ) {
        if (currentPadding.paddingPx !== paddingPx) {
          paddingBySide.set(side, { ...currentPadding, paddingPx: null });
        }
        continue;
      }
      paddingBySide.set(side, { isImportant, paddingPx, specificity });
    }
  };
  for (const markedToken of tokens) {
    const isImportant = markedToken.startsWith("!");
    const token = isImportant ? markedToken.slice(1) : markedToken;
    const spacingMatch = token.match(TAILWIND_PADDING_PATTERN);
    if (spacingMatch) {
      setPadding(
        spacingMatch[1],
        spacingMatch[2] === "px" ? 1 : parseFloat(spacingMatch[2]) * TAILWIND_SPACING_UNIT_PX,
        isImportant,
      );
    }
    const arbitraryMatch = token.match(ARBITRARY_PADDING_PATTERN);
    if (arbitraryMatch) {
      const value = parseFloat(arbitraryMatch[2]);
      setPadding(
        arbitraryMatch[1],
        arbitraryMatch[3] === "rem" ? value * ROOT_FONT_SIZE_PX : value,
        isImportant,
      );
    }
  }
  let minimumImportantPaddingPx: number | null = null;
  let minimumPaddingPx: number | null = null;
  for (const padding of paddingBySide.values()) {
    if (padding.paddingPx === null) {
      return { minimumImportantPaddingPx: null, minimumPaddingPx: null };
    }
    minimumPaddingPx =
      minimumPaddingPx === null ? padding.paddingPx : Math.min(minimumPaddingPx, padding.paddingPx);
    if (padding.isImportant) {
      minimumImportantPaddingPx =
        minimumImportantPaddingPx === null
          ? padding.paddingPx
          : Math.min(minimumImportantPaddingPx, padding.paddingPx);
    }
  }
  return { minimumImportantPaddingPx, minimumPaddingPx };
};

const getTailwindUtilityResolution = (tokens: string[], predicate: (utility: string) => boolean) =>
  resolveEffectiveTailwindClassNameToken(tokens, predicate);

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
      const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
      if (!styleAttribute && hasJsxSpreadAttribute(openingElement.attributes)) return;
      const styleExpression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
      if (styleAttribute && !styleExpression) return;
      if (styleExpression?.properties.some((property) => !getStylePropertyKey(property))) {
        return;
      }
      const inlinePadding = getEffectiveInlinePadding(styleExpression?.properties);
      const inlineBackground = getEffectiveStylePropertyAmong(
        styleExpression?.properties,
        BACKGROUND_STYLE_PROPERTIES,
      );
      const inlineBoxShadow = getEffectiveStyleProperty(styleExpression?.properties, "boxShadow");
      const inlineOutline = getEffectiveStyleProperty(styleExpression?.properties, "outline");
      const hasVisibleInlineSurface =
        Boolean(inlineBackground && isVisibleInlineBoundary(inlineBackground)) ||
        hasVisibleInlineBorder(styleExpression?.properties, false) ||
        Boolean(inlineBoxShadow && isVisibleInlineBoundary(inlineBoxShadow)) ||
        Boolean(inlineOutline && isVisibleInlineBoundary(inlineOutline));
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (classNameValue && hasCapabilityOrUnspecified(context.settings, "tailwind")) {
        const tokens = getUnvariantClassNameTokensWithImportantModifiers(classNameValue);
        const paddingResolution = getTailwindPaddingResolution(tokens);
        const backgroundResolution = getTailwindUtilityResolution(tokens, (utility) =>
          TAILWIND_BACKGROUND_COLOR_PATTERN.test(utility),
        );
        const borderResolution = getTailwindUtilityResolution(tokens, (utility) =>
          TAILWIND_BORDER_GEOMETRY_PATTERN.test(utility),
        );
        const shadowResolution = getTailwindUtilityResolution(tokens, (utility) =>
          TAILWIND_SHADOW_GEOMETRY_PATTERN.test(utility),
        );
        const isBackgroundProtected =
          backgroundResolution.isImportant || backgroundResolution.isAmbiguous;
        const isBorderProtected = borderResolution.isImportant || borderResolution.isAmbiguous;
        const isShadowProtected = shadowResolution.isImportant || shadowResolution.isAmbiguous;
        const hasVisibleBackground =
          inlineBackground && !isBackgroundProtected
            ? isVisibleInlineBoundary(inlineBackground)
            : hasVisibleTailwindBackground(tokens);
        const hasVisibleBorder = isBorderProtected
          ? hasVisibleTailwindClosedBorder(tokens)
          : hasVisibleInlineBorder(
              styleExpression?.properties,
              hasVisibleTailwindClosedBorder(tokens),
            );
        const hasVisibleRing =
          inlineBoxShadow && !isShadowProtected
            ? isVisibleInlineBoundary(inlineBoxShadow)
            : hasVisibleTailwindRing(tokens);
        const hasVisibleBoundary = hasVisibleBackground || hasVisibleBorder || hasVisibleRing;
        const effectivePaddingPx =
          inlinePadding &&
          inlinePadding.coveredSideCount === PADDING_SIDES_BY_PROPERTY.get("padding")?.length
            ? Math.min(
                inlinePadding.paddingPx,
                paddingResolution.minimumImportantPaddingPx ?? Number.POSITIVE_INFINITY,
              )
            : paddingResolution.minimumPaddingPx;
        if (
          hasVisibleBoundary &&
          effectivePaddingPx !== null &&
          effectivePaddingPx < MIN_BOUNDED_CONTAINER_PADDING_PX
        ) {
          context.report({
            node: openingElement,
            message: `This visible container leaves only ${effectivePaddingPx}px around its text. Use at least ${MIN_BOUNDED_CONTAINER_PADDING_PX}px of padding.`,
          });
          return;
        }
      }

      if (styleExpression) {
        if (
          hasVisibleInlineSurface &&
          inlinePadding &&
          inlinePadding.paddingPx < MIN_BOUNDED_CONTAINER_PADDING_PX
        ) {
          context.report({
            node: inlinePadding.property,
            message: `This bounded surface gives its text ${inlinePadding.paddingPx}px of padding. Increase it to at least ${MIN_BOUNDED_CONTAINER_PADDING_PX}px.`,
          });
        }
      }
    },
  }),
});
