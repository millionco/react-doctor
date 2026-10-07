import {
  PULSING_STATUS_DOT_MAX_SIZE_PX,
  PULSING_STATUS_DOT_MIN_SIZE_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isInsideStaticallyHiddenJsxSubtree } from "../../utils/is-inside-statically-hidden-jsx-subtree.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { parseStaticTailwindLengthPx } from "./utils/parse-static-tailwind-length-px.js";

const ANIMATION_UTILITY_PATTERN = /^animate-/;
const ROUNDING_UTILITY_PATTERN = /^rounded(?:-|$)/;
const WIDTH_UTILITY_PATTERN = /^(?:size|w)-/;
const HEIGHT_UTILITY_PATTERN = /^(?:h|size)-/;
const PULSING_ANIMATION_UTILITIES = new Set(["animate-ping", "animate-pulse"]);
const LIVE_STATUS_ROLES = new Set(["alert", "progressbar", "status"]);

const hasTinySquareSize = (tokens: string[]): boolean => {
  const widthUtility = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    WIDTH_UTILITY_PATTERN.test(utility),
  );
  const heightUtility = getEffectiveTailwindClassNameToken(tokens, (utility) =>
    HEIGHT_UTILITY_PATTERN.test(utility),
  );
  const widthPx = widthUtility
    ? (parseStaticTailwindLengthPx(widthUtility, "size") ??
      parseStaticTailwindLengthPx(widthUtility, "w"))
    : null;
  const heightPx = heightUtility
    ? (parseStaticTailwindLengthPx(heightUtility, "size") ??
      parseStaticTailwindLengthPx(heightUtility, "h"))
    : null;
  return Boolean(
    widthPx !== null &&
    heightPx !== null &&
    widthPx === heightPx &&
    widthPx >= PULSING_STATUS_DOT_MIN_SIZE_PX &&
    widthPx <= PULSING_STATUS_DOT_MAX_SIZE_PX,
  );
};

const readStaticBooleanValue = (value: unknown): boolean | null => {
  if (typeof value !== "boolean" && typeof value !== "string") return null;
  const normalizedValue = value.toString().toLowerCase();
  if (normalizedValue === "true") return true;
  if (normalizedValue === "false") return false;
  return null;
};

const getStaticBooleanAttributeValue = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): boolean | null => {
  if (!attribute.value) return true;
  if (isNodeOfType(attribute.value, "Literal")) {
    return readStaticBooleanValue(attribute.value.value);
  }
  if (
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal")
  ) {
    return readStaticBooleanValue(attribute.value.expression.value);
  }
  return null;
};

const hasOnlyWhitespaceChildren = (element: EsTreeNodeOfType<"JSXElement">): boolean =>
  element.children.every(
    (child) => isNodeOfType(child, "JSXText") && child.value.trim().length === 0,
  );

const hasLiveStatusSemanticExemption = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  let ancestor: EsTreeNode | null | undefined = element;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingElement = ancestor.openingElement;
      if (hasJsxSpreadAttribute(openingElement.attributes)) return true;

      const ariaBusyAttribute = getAuthoritativeJsxAttribute(
        openingElement.attributes,
        "aria-busy",
        false,
      );
      if (ariaBusyAttribute && getStaticBooleanAttributeValue(ariaBusyAttribute) !== false) {
        return true;
      }

      const ariaLiveAttribute = getAuthoritativeJsxAttribute(
        openingElement.attributes,
        "aria-live",
        false,
      );
      if (ariaLiveAttribute) {
        const ariaLiveValue = getStringLiteralAttributeValue(ariaLiveAttribute);
        if (!ariaLiveValue || ariaLiveValue.trim().toLowerCase() !== "off") return true;
      }

      const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
      if (roleAttribute) {
        const roleValue = getStringLiteralAttributeValue(roleAttribute);
        if (
          !roleValue ||
          roleValue
            .trim()
            .toLowerCase()
            .split(/\s+/)
            .some((role) => LIVE_STATUS_ROLES.has(role))
        ) {
          return true;
        }
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isHeaderContext = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isNodeOfType(ancestor.openingElement.name, "JSXIdentifier") &&
      ancestor.openingElement.name.name === "header"
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isStrictNavigationContext = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingElement = ancestor.openingElement;
      if (
        isNodeOfType(openingElement.name, "JSXIdentifier") &&
        openingElement.name.name === "nav"
      ) {
        return true;
      }
      const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
      const roleValue = roleAttribute ? getStringLiteralAttributeValue(roleAttribute) : null;
      if (
        roleValue
          ?.trim()
          .toLowerCase()
          .split(/\s+/)
          .some((role) => role === "navigation")
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isHeroContext = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXElement") &&
      isNodeOfType(ancestor.openingElement.name, "JSXIdentifier") &&
      ancestor.openingElement.name.name === "section"
    ) {
      return getStaticJsxDescendantOpeningElements(ancestor).some(
        (openingElement) =>
          isNodeOfType(openingElement.name, "JSXIdentifier") && openingElement.name.name === "h1",
      );
    }
    ancestor = ancestor.parent;
  }
  return false;
};

export const noPulsingStatusDot = defineRule({
  id: "no-pulsing-status-dot",
  title: "Decorative status dot pulses continuously",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  requires: ["tailwind"],
  recommendation:
    "Use a static status indicator unless the element communicates real work in progress.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (
        !isProvenIntrinsicJsxElement(openingElement, context.scopes) ||
        getAuthoritativeJsxAttribute(openingElement.attributes, "style") !== null ||
        !hasOnlyWhitespaceChildren(node) ||
        hasLiveStatusSemanticExemption(node) ||
        isInsideStaticallyHiddenJsxSubtree(node, context) ||
        (!isStrictNavigationContext(node) && !isHeaderContext(node) && !isHeroContext(node))
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (!classNameValue) return;
      const tokens = splitTailwindClassName(classNameValue);
      const animationUtility = getEffectiveTailwindClassNameToken(tokens, (utility) =>
        ANIMATION_UTILITY_PATTERN.test(utility),
      );
      if (!animationUtility || !PULSING_ANIMATION_UTILITIES.has(animationUtility)) return;
      const roundingUtility = getEffectiveTailwindClassNameToken(tokens, (utility) =>
        ROUNDING_UTILITY_PATTERN.test(utility),
      );
      if (roundingUtility !== "rounded-full" || !hasTinySquareSize(tokens)) return;
      context.report({
        node: openingElement,
        message:
          "This tiny status dot pulses continuously without representing work in progress. Use a static indicator for passive availability or decoration.",
      });
    },
  }),
});
