import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { getStaticJsxDescendantOpeningElements } from "../../utils/get-static-jsx-descendant-opening-elements.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { resolveEffectiveTailwindClassNameToken } from "./utils/resolve-effective-tailwind-class-name-token.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { splitCssTopLevel } from "./utils/split-css-top-level.js";

const BUSY_TEXT_PATTERN = /\b(?:loading|processing|saving|syncing|uploading)\b/i;
const CURSOR_GLYPH_PATTERN = /^[_|▀-▟■▮❙❚｜]$/u;
const CURSOR_ANIMATION_NAME_PATTERN = /(?:^|[-_\s])(?:blink|caret|cursor|pulse)(?:$|[-_\s])/i;
const INFINITE_ANIMATION_TOKEN_PATTERN = /(?:^|\s)infinite(?:$|\s)/i;
const HERO_CONTEXT_NAME_PATTERN = /(?:Hero|Landing|Marketing|Masthead)/;
const HERO_CONTEXT_CLASS_PATTERN = /(?:^|[-_:])(?:hero|landing|marketing|masthead)(?:$|[-_:])/i;
const PREFORMATTED_CONTEXT_NAME_PATTERN = /(?:Code|Console|Diff|Editor|Syntax|Terminal)/;
const PREFORMATTED_CONTEXT_CLASS_PATTERN =
  /(?:^|[-_:])(?:code|console|diff|editor|syntax|terminal)(?:$|[-_:])/i;
const EXCLUDED_CONTENT_PATH_PATTERN = /(?:^|[/\\])(?:docs?|documentation)(?:[/\\]|$)/i;
const CURSOR_EXEMPT_ROLES = new Set(["progressbar", "status", "textbox"]);
const CURSOR_EXEMPT_ELEMENT_NAMES = new Set(["code", "input", "pre", "textarea"]);
const TAILWIND_ANIMATION_UTILITY_PATTERN = /^(?:animate-|\[animation:)/;

const getStaticAttributeValue = (attribute: EsTreeNodeOfType<"JSXAttribute">): unknown => {
  const value = attribute.value as EsTreeNode | null;
  if (!value) return true;
  const expression = isNodeOfType(value, "JSXExpressionContainer") ? value.expression : value;
  return isNodeOfType(expression, "Literal") ? expression.value : null;
};

const isBusyStatus = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const ariaBusyAttribute = findJsxAttribute(openingElement.attributes, "aria-busy");
  const ariaBusyValue = ariaBusyAttribute && getStaticAttributeValue(ariaBusyAttribute);
  if (ariaBusyValue === true || ariaBusyValue === "true" || ariaBusyValue === null) return true;
  const roleAttribute = findJsxAttribute(openingElement.attributes, "role");
  const roleValue = roleAttribute && getStaticAttributeValue(roleAttribute);
  return roleValue === "status" || roleValue === "progressbar";
};

const getStaticCursorText = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "JSXText")) return node.value;
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value === "string" ? node.value : null;
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    if (node.expressions.length > 0) return null;
    return node.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join("");
  }
  if (isNodeOfType(node, "JSXExpressionContainer")) {
    return getStaticCursorText(node.expression);
  }
  if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
    let text = "";
    for (const child of node.children) {
      const childText = getStaticCursorText(child);
      if (childText === null) return null;
      text += childText;
    }
    return text;
  }
  return null;
};

const getStaticCursorGlyph = (element: EsTreeNodeOfType<"JSXElement">): string | null => {
  const glyph = getStaticCursorText(element)?.trim() ?? "";
  return CURSOR_GLYPH_PATTERN.test(glyph) ? glyph : null;
};

const hasCursorAnimationName = (value: string): boolean =>
  CURSOR_ANIMATION_NAME_PATTERN.test(value.replaceAll("\\_", "_"));

const isInfiniteCursorAnimation = (value: string): boolean => {
  const animationSegments = splitCssTopLevel(value, ",");
  return Boolean(
    animationSegments?.length === 1 &&
    INFINITE_ANIMATION_TOKEN_PATTERN.test(value) &&
    hasCursorAnimationName(value),
  );
};

const getInlineCursorAnimationState = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean | null => {
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  if (!styleAttribute) return null;
  const styleExpression = getInlineStyleExpression(styleAttribute, context.scopes);
  if (
    !styleExpression ||
    styleExpression.properties.some((property) => getStylePropertyKey(property) === null)
  ) {
    return null;
  }

  const animationProperty = getEffectiveStyleProperty(styleExpression.properties, "animation");
  if (animationProperty) {
    const animationValue = getStylePropertyStringValue(animationProperty);
    return animationValue === null ? null : isInfiniteCursorAnimation(animationValue);
  }

  const animationNameProperty = getEffectiveStyleProperty(
    styleExpression.properties,
    "animationName",
  );
  const animationIterationCountProperty = getEffectiveStyleProperty(
    styleExpression.properties,
    "animationIterationCount",
  );
  if (!animationNameProperty && !animationIterationCountProperty) return null;
  if (!animationNameProperty || !animationIterationCountProperty) return null;
  const animationName = getStylePropertyStringValue(animationNameProperty);
  const animationIterationCount = getStylePropertyStringValue(animationIterationCountProperty);
  if (animationName === null || animationIterationCount === null) return null;
  return (
    animationIterationCount.toLowerCase() === "infinite" && hasCursorAnimationName(animationName)
  );
};

const hasStaticTailwindCursorAnimation = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const animationResolution = resolveEffectiveTailwindClassNameToken(
    splitTailwindClassName(classNameValue),
    (utility) => TAILWIND_ANIMATION_UTILITY_PATTERN.test(utility),
  );
  if (animationResolution.isAmbiguous || !animationResolution.utility) return false;
  if (animationResolution.utility === "animate-pulse") return true;
  const arbitraryAnimation =
    animationResolution.utility.match(/^animate-\[(.+)\]$/)?.[1] ??
    animationResolution.utility.match(/^\[animation:(.+)\]$/)?.[1];
  return Boolean(
    arbitraryAnimation && isInfiniteCursorAnimation(arbitraryAnimation.replaceAll("_", " ")),
  );
};

const hasProvenCursorAnimation = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const inlineAnimationState = getInlineCursorAnimationState(openingElement, context);
  return inlineAnimationState ?? hasStaticTailwindCursorAnimation(openingElement);
};

const getAncestorOpeningElements = (
  element: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXOpeningElement">[] => {
  const openingElements: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
  let ancestor: EsTreeNode | null | undefined = element;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      openingElements.push(ancestor.openingElement);
    }
    ancestor = ancestor.parent;
  }
  return openingElements;
};

const hasUnresolvedOrEnabledAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute) return false;
  const value = getStaticAttributeValue(attribute);
  return value !== false && value !== "false";
};

const hasCursorSemanticExemption = (
  openingElements: ReadonlyArray<EsTreeNodeOfType<"JSXOpeningElement">>,
): boolean =>
  openingElements.some((openingElement) => {
    if (hasJsxSpreadAttribute(openingElement.attributes)) return true;
    const elementName = resolveJsxElementType(openingElement);
    if (
      CURSOR_EXEMPT_ELEMENT_NAMES.has(elementName.toLowerCase()) ||
      PREFORMATTED_CONTEXT_NAME_PATTERN.test(elementName) ||
      hasUnresolvedOrEnabledAttribute(openingElement, "contentEditable") ||
      hasUnresolvedOrEnabledAttribute(openingElement, "aria-busy")
    ) {
      return true;
    }

    const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
    if (roleAttribute) {
      const role = getStringLiteralAttributeValue(roleAttribute);
      if (!role || CURSOR_EXEMPT_ROLES.has(role.trim().toLowerCase().split(/\s+/)[0])) {
        return true;
      }
    }

    const ariaLiveAttribute = getAuthoritativeJsxAttribute(
      openingElement.attributes,
      "aria-live",
      false,
    );
    if (ariaLiveAttribute) {
      const ariaLive = getStringLiteralAttributeValue(ariaLiveAttribute);
      if (!ariaLive || ariaLive.toLowerCase() !== "off") return true;
    }

    const classNameValue = getStringFromClassNameAttr(openingElement);
    return Boolean(
      classNameValue &&
      splitTailwindClassName(classNameValue)
        .map(parseTailwindClassNameToken)
        .some((token) => PREFORMATTED_CONTEXT_CLASS_PATTERN.test(token.utility)),
    );
  });

const isHeroDisplayContext = (element: EsTreeNodeOfType<"JSXElement">): boolean => {
  let ancestor = element.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingElement = ancestor.openingElement;
      const elementName = resolveJsxElementType(openingElement);
      if (elementName === "h1" || HERO_CONTEXT_NAME_PATTERN.test(elementName)) return true;
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (
        classNameValue &&
        splitTailwindClassName(classNameValue)
          .map(parseTailwindClassNameToken)
          .some((token) => HERO_CONTEXT_CLASS_PATTERN.test(token.utility))
      ) {
        return true;
      }
      if (
        (elementName === "header" || elementName === "section") &&
        getStaticJsxDescendantOpeningElements(ancestor).some(
          (descendant) => resolveJsxElementType(descendant) === "h1",
        )
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isExcludedContentPath = (context: RuleContext): boolean => {
  const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory") ?? "";
  return EXCLUDED_CONTENT_PATH_PATTERN.test(`${rootDirectory}/${context.filename ?? ""}`);
};

export const noDecorativePulse = defineRule({
  id: "no-decorative-pulse",
  title: "Stable copy pulses for attention",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Reserve pulsing motion for real in-progress feedback. Remove fake blinking cursors and use static hierarchy for decorative emphasis.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      const cursorGlyph = getStaticCursorGlyph(node);
      const possibleCursorGlyph = getStaticJsxText(node).trim();
      if (cursorGlyph || CURSOR_GLYPH_PATTERN.test(possibleCursorGlyph)) {
        if (!cursorGlyph) return;
        const openingElements = getAncestorOpeningElements(node);
        if (
          isExcludedContentPath(context) ||
          hasCursorSemanticExemption(openingElements) ||
          !isHeroDisplayContext(node) ||
          !hasProvenCursorAnimation(openingElement, context)
        ) {
          return;
        }
        context.report({
          node: openingElement,
          message:
            "This fake cursor blinks continuously in display copy without an editable surface. Remove the simulated typing effect and let the composition hold attention.",
        });
        return;
      }
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (!classNameValue) return;
      const animationResolution = resolveEffectiveTailwindClassNameToken(
        splitTailwindClassName(classNameValue),
        (utility) => TAILWIND_ANIMATION_UTILITY_PATTERN.test(utility),
      );
      if (animationResolution.isAmbiguous || animationResolution.utility !== "animate-pulse") {
        return;
      }
      const text = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (!text || BUSY_TEXT_PATTERN.test(text)) return;
      if (isBusyStatus(openingElement)) return;
      context.report({
        node: openingElement,
        message:
          "This stable copy pulses continuously for attention. Remove the loop and use static hierarchy unless the element represents work in progress.",
      });
    },
  }),
});
