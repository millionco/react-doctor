import {
  NUMBERED_SECTION_LABEL_MAX_CHARACTERS,
  NUMBERED_SECTION_LABEL_MAX_FONT_SIZE_PX,
  NUMBERED_SECTION_LABEL_MAX_INDEX,
  NUMBERED_SECTION_LABEL_MIN_FONT_WEIGHT,
  NUMBERED_SECTION_LABEL_MIN_COUNT,
} from "../../constants/design.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { getNextStaticJsxElementSibling } from "../../utils/get-next-static-jsx-element-sibling.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getTailwindVisibilityAtBreakpoints } from "../../utils/get-tailwind-visibility-at-breakpoints.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStaticEffectiveFontSize } from "./utils/get-static-effective-font-size.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

interface NumberedSectionLabel {
  index: number;
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">;
}

const NUMBERED_LABEL_ELEMENT_NAMES = new Set(["b", "div", "em", "p", "small", "span", "strong"]);
const WRAPPED_HEADING_ELEMENT_NAMES = new Set(["div", "header"]);
const ORDERED_CONTEXT_ELEMENT_NAMES = new Set([
  "article",
  "li",
  "menu",
  "nav",
  "ol",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "time",
  "tr",
  "ul",
]);
const ORDERED_CONTEXT_ROLES = new Set(["list", "listitem", "navigation", "progressbar", "status"]);
const HEADING_ELEMENT_PATTERN = /^h[1-6]$/;
const ORDERED_CONTEXT_CLASS_SEGMENT_PATTERN =
  /(?:^|[-_:])(?:calendar|card|card-item|date|day|milestone|month|progress|step|stepper|steps|timeline|year)(?:$|[-_:])/i;
const ORDERED_CONTEXT_COMPONENT_NAME_PATTERN =
  /(?:Calendar|Date|Day|Milestone|Month|Progress|Step|Stepper|Timeline|Year)/;
const ORDERED_CONTEXT_LABEL_PATTERN = /\b(?:progress|step|steps)\b/i;
const ORDERED_HEADING_PATTERN = /^(?:phase|stage|step)\b/i;
const DATE_HEADING_PATTERN =
  /^(?:fri(?:day)?|mon(?:day)?|sat(?:urday)?|sun(?:day)?|thu(?:rsday)?|tue(?:sday)?|wed(?:nesday)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const DATE_LIKE_LABEL_PATTERN =
  /\b(?:19|20)\d{2}\b|\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\d{1,2}[./:-]\d{1,2}/i;
const BARE_NUMBERED_LABEL_PATTERN = /^(\d{2})$/;
const COMPOUND_NUMBERED_LABEL_PATTERN = /^(\d{1,2})\s*[/|·•—–]\s*\p{L}/u;
const ACCENT_TEXT_CLASS_PATTERN =
  /^text-(?:amber|blue|cyan|emerald|fuchsia|green|indigo|lime|orange|pink|purple|red|rose|sky|teal|violet|yellow)-\d{2,3}$/;
const ACCENT_ARBITRARY_TEXT_CLASS_PATTERN = /^text-\[(?:#|color:|hsl|oklch|rgb)/i;
const BOLD_FONT_CLASS_NAMES = new Set([
  "font-black",
  "font-bold",
  "font-extrabold",
  "font-semibold",
]);

const getFullyStaticJsxText = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return "";
  if (isNodeOfType(node, "JSXText")) return node.value ?? "";
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value === "string" || typeof node.value === "number"
      ? String(node.value)
      : null;
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return node.expressions.length === 0 ? (node.quasis[0]?.value.raw ?? "") : null;
  }
  if (isNodeOfType(node, "JSXExpressionContainer")) {
    return isNodeOfType(node.expression, "JSXEmptyExpression")
      ? ""
      : getFullyStaticJsxText(node.expression);
  }
  if (isNodeOfType(node, "JSXElement") || isNodeOfType(node, "JSXFragment")) {
    let text = "";
    for (const child of node.children ?? []) {
      const childText = getFullyStaticJsxText(child);
      if (childText === null) return null;
      text += childText;
    }
    return text;
  }
  return null;
};

const getOutermostJsxRoot = (
  node: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment"> => {
  let outermostJsxRoot: EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment"> = node;
  let ancestor = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement") || isNodeOfType(ancestor, "JSXFragment")) {
      outermostJsxRoot = ancestor;
    }
    ancestor = ancestor.parent;
  }
  return outermostJsxRoot;
};

const hasConditionalOrLogicalAncestor = (node: EsTreeNode): boolean => {
  let ancestor = node.parent;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "ConditionalExpression") ||
      isNodeOfType(ancestor, "LogicalExpression")
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const getAncestorOpeningElements = (
  node: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXOpeningElement">[] => {
  const openingElements: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
  let ancestor: EsTreeNode | null | undefined = node;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      openingElements.push(ancestor.openingElement);
    }
    ancestor = ancestor.parent;
  }
  return openingElements;
};

const hasUnresolvedJsxAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  attributeName: string,
): boolean => {
  const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
  if (!attribute?.value) return false;
  if (getStringLiteralAttributeValue(attribute) !== null) return false;
  return !(
    isNodeOfType(attribute.value, "JSXExpressionContainer") &&
    isNodeOfType(attribute.value.expression, "Literal")
  );
};

const hasUnresolvedInlineRenderingStyle = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  if (!styleAttribute) return false;
  const styleExpression = getInlineStyleExpression(styleAttribute, scopes);
  if (!styleExpression) return true;
  if (styleExpression.properties.some((property) => getStylePropertyKey(property) === null)) {
    return true;
  }
  for (const propertyName of ["display", "visibility"]) {
    const property = getEffectiveStyleProperty(styleExpression.properties, propertyName);
    if (property && getStylePropertyStringValue(property) === null) return true;
  }
  return false;
};

const isHiddenOrRenderingUnknown = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  hasTailwind: boolean,
  scopes: ScopeAnalysis,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean => {
  if (
    hasJsxSpreadAttribute(openingElement.attributes) ||
    hasUnresolvedJsxAttribute(openingElement, "hidden") ||
    hasUnresolvedJsxAttribute(openingElement, "aria-hidden") ||
    hasUnresolvedInlineRenderingStyle(openingElement, scopes)
  ) {
    return true;
  }
  const classNameAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "className");
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (classNameAttribute && classNameValue === null) return true;
  if (isHiddenFromScreenReader(openingElement, settings)) return true;
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  const styleExpression = styleAttribute ? getInlineStyleExpression(styleAttribute, scopes) : null;
  if (styleExpression) {
    const displayProperty = getEffectiveStyleProperty(styleExpression.properties, "display");
    if (displayProperty && getStylePropertyStringValue(displayProperty)?.toLowerCase() === "none") {
      return true;
    }
    const visibilityProperty = getEffectiveStyleProperty(styleExpression.properties, "visibility");
    const visibilityValue = visibilityProperty
      ? getStylePropertyStringValue(visibilityProperty)?.toLowerCase()
      : null;
    if (visibilityValue === "hidden" || visibilityValue === "collapse") return true;
  }
  if (!hasTailwind || !classNameValue) return false;
  const visibilityAtBreakpoints = getTailwindVisibilityAtBreakpoints(classNameValue);
  return (
    visibilityAtBreakpoints === null || visibilityAtBreakpoints.every((isVisible) => !isVisible)
  );
};

const hasHiddenOrUnknownAncestor = (
  node: EsTreeNodeOfType<"JSXElement">,
  hasTailwind: boolean,
  scopes: ScopeAnalysis,
  settings: Readonly<Record<string, unknown>> | undefined,
): boolean =>
  getAncestorOpeningElements(node).some((openingElement) =>
    isHiddenOrRenderingUnknown(openingElement, hasTailwind, scopes, settings),
  );

const parseNumberedSectionLabel = (text: string): number | null => {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  if (
    !normalizedText ||
    normalizedText.length > NUMBERED_SECTION_LABEL_MAX_CHARACTERS ||
    DATE_LIKE_LABEL_PATTERN.test(normalizedText)
  ) {
    return null;
  }
  const match =
    normalizedText.match(BARE_NUMBERED_LABEL_PATTERN) ??
    normalizedText.match(COMPOUND_NUMBERED_LABEL_PATTERN);
  if (!match) return null;
  const index = Number.parseInt(match[1], 10);
  return index > 0 && index <= NUMBERED_SECTION_LABEL_MAX_INDEX ? index : null;
};

const getHeadingFromElement = (
  element: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXElement"> | null => {
  if (!isNodeOfType(element.openingElement.name, "JSXIdentifier")) return null;
  if (HEADING_ELEMENT_PATTERN.test(element.openingElement.name.name)) return element;
  if (!WRAPPED_HEADING_ELEMENT_NAMES.has(element.openingElement.name.name)) return null;
  for (const child of element.children ?? []) {
    if (isNodeOfType(child, "JSXText") && child.value.trim() === "") continue;
    if (
      isNodeOfType(child, "JSXExpressionContainer") &&
      isNodeOfType(child.expression, "JSXEmptyExpression")
    ) {
      continue;
    }
    return isNodeOfType(child, "JSXElement") ? getHeadingFromElement(child) : null;
  }
  return null;
};

const getFollowingStaticHeading = (
  node: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXElement"> | null => {
  const sibling = getNextStaticJsxElementSibling(node);
  if (!sibling) return null;
  const heading = getHeadingFromElement(sibling);
  const headingText = getFullyStaticJsxText(heading);
  if (!heading || !headingText) return null;
  const normalizedHeadingText = headingText.replace(/\s+/g, " ").trim();
  if (
    !normalizedHeadingText ||
    ORDERED_HEADING_PATTERN.test(normalizedHeadingText) ||
    DATE_HEADING_PATTERN.test(normalizedHeadingText)
  ) {
    return null;
  }
  return heading;
};

const hasOrderedOrUnresolvedContext = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  let ancestor: EsTreeNode | null | undefined = node;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement")) {
      const openingElement = ancestor.openingElement;
      if (hasJsxSpreadAttribute(openingElement.attributes)) return true;
      if (isNodeOfType(openingElement.name, "JSXIdentifier")) {
        const elementName = openingElement.name.name;
        if (ORDERED_CONTEXT_ELEMENT_NAMES.has(elementName)) return true;
        if (ORDERED_CONTEXT_COMPONENT_NAME_PATTERN.test(elementName)) return true;
      }
      const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
      const roleValue = roleAttribute ? getStringLiteralAttributeValue(roleAttribute) : null;
      if (roleAttribute && roleValue === null) return true;
      const role = roleValue?.toLowerCase();
      if (role && ORDERED_CONTEXT_ROLES.has(role)) return true;
      const dateTimeAttribute = getAuthoritativeJsxAttribute(
        openingElement.attributes,
        "dateTime",
        false,
      );
      if (dateTimeAttribute) return true;
      const ariaLabelAttribute = getAuthoritativeJsxAttribute(
        openingElement.attributes,
        "aria-label",
        false,
      );
      const ariaLabelValue = ariaLabelAttribute
        ? getStringLiteralAttributeValue(ariaLabelAttribute)
        : null;
      if (ariaLabelAttribute && ariaLabelValue === null) return true;
      const ariaLabel = ariaLabelValue ?? "";
      if (ariaLabel && ORDERED_CONTEXT_LABEL_PATTERN.test(ariaLabel)) return true;
      const classNameAttribute = getAuthoritativeJsxAttribute(
        openingElement.attributes,
        "className",
      );
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (classNameAttribute && classNameValue === null) return true;
      if (classNameValue && ORDERED_CONTEXT_CLASS_SEGMENT_PATTERN.test(classNameValue)) return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const hasInlineMicroLabelTreatment = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  if (!styleAttribute) return false;
  const styleExpression = getInlineStyleExpression(styleAttribute, scopes);
  if (!styleExpression) return false;
  const fontFamily = getEffectiveStyleProperty(styleExpression.properties, "fontFamily");
  if (fontFamily && /mono/i.test(getStylePropertyStringValue(fontFamily) ?? "")) return true;
  const fontWeight = getEffectiveStyleProperty(styleExpression.properties, "fontWeight");
  if (fontWeight) {
    const numericWeight =
      getStylePropertyNumberValue(fontWeight) ??
      Number.parseInt(getStylePropertyStringValue(fontWeight) ?? "", 10);
    if (numericWeight >= NUMBERED_SECTION_LABEL_MIN_FONT_WEIGHT) return true;
    if (/^(?:bold|bolder)$/i.test(getStylePropertyStringValue(fontWeight) ?? "")) return true;
  }
  const letterSpacing = getEffectiveStyleProperty(styleExpression.properties, "letterSpacing");
  if (letterSpacing) {
    const letterSpacingValue =
      getStylePropertyNumberValue(letterSpacing) ??
      Number.parseFloat(getStylePropertyStringValue(letterSpacing) ?? "");
    if (letterSpacingValue > 0) return true;
  }
  const textTransform = getEffectiveStyleProperty(styleExpression.properties, "textTransform");
  return Boolean(
    textTransform && getStylePropertyStringValue(textTransform)?.toLowerCase() === "uppercase",
  );
};

const hasTailwindMicroLabelTreatment = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const classNameTokens = getUnvariantClassNameTokens(classNameValue);
  return classNameTokens.some(
    (classNameToken) =>
      classNameToken === "font-mono" ||
      classNameToken === "uppercase" ||
      BOLD_FONT_CLASS_NAMES.has(classNameToken) ||
      (classNameToken.startsWith("tracking-") && classNameToken !== "tracking-normal") ||
      ACCENT_TEXT_CLASS_PATTERN.test(classNameToken) ||
      ACCENT_ARBITRARY_TEXT_CLASS_PATTERN.test(classNameToken),
  );
};

const getSectionMarker = (
  node: EsTreeNodeOfType<"JSXElement">,
  hasTailwind: boolean,
  scopes: ScopeAnalysis,
  settings: Readonly<Record<string, unknown>> | undefined,
): NumberedSectionLabel | null => {
  const heading = getFollowingStaticHeading(node);
  if (
    !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
    !NUMBERED_LABEL_ELEMENT_NAMES.has(node.openingElement.name.name) ||
    !heading ||
    hasConditionalOrLogicalAncestor(node) ||
    hasOrderedOrUnresolvedContext(node) ||
    hasOrderedOrUnresolvedContext(heading) ||
    hasHiddenOrUnknownAncestor(node, hasTailwind, scopes, settings) ||
    hasHiddenOrUnknownAncestor(heading, hasTailwind, scopes, settings)
  ) {
    return null;
  }
  const text = getFullyStaticJsxText(node);
  if (text === null) return null;
  const index = parseNumberedSectionLabel(text);
  if (index === null) return null;
  const fontSize = getStaticEffectiveFontSize(node.openingElement, hasTailwind, scopes);
  if (fontSize === null || fontSize <= 0 || fontSize > NUMBERED_SECTION_LABEL_MAX_FONT_SIZE_PX) {
    return null;
  }
  if (
    !hasInlineMicroLabelTreatment(node.openingElement, scopes) &&
    !(hasTailwind && hasTailwindMicroLabelTreatment(node.openingElement))
  ) {
    return null;
  }
  return { index, openingElement: node.openingElement };
};

export const noNumberedSectionMarkers = defineRule({
  id: "no-numbered-section-markers",
  title: "Styled numbers are used as section decoration",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Remove decorative section numbering unless the sequence communicates real progress or ordered steps.",
  create: (context: RuleContext) => {
    const hasTailwind = hasCapabilityOrUnspecified(context.settings, "tailwind");
    const markerBuckets = new Map<
      EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment">,
      Map<number, EsTreeNodeOfType<"JSXOpeningElement">>
    >();
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const marker = getSectionMarker(node, hasTailwind, context.scopes, context.settings);
        if (!marker) return;
        const outermostJsxRoot = getOutermostJsxRoot(node);
        const existingBucket = markerBuckets.get(outermostJsxRoot);
        if (existingBucket) {
          existingBucket.set(marker.index, marker.openingElement);
          return;
        }
        markerBuckets.set(outermostJsxRoot, new Map([[marker.index, marker.openingElement]]));
      },
      "Program:exit"() {
        for (const markers of markerBuckets.values()) {
          if (markers.size < NUMBERED_SECTION_LABEL_MIN_COUNT) continue;
          const firstNode = markers.values().next().value;
          if (!firstNode) continue;
          context.report({
            node: firstNode,
            message:
              "Several headings are prefixed with styled numeric labels. Keep numbering for genuinely ordered steps, not visual scaffolding.",
          });
        }
      },
    };
  },
});
