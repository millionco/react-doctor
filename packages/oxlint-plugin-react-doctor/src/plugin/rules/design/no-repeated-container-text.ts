import {
  REPEATED_CONTAINER_TEXT_MAX_DESCENDANT_COUNT,
  REPEATED_CONTAINER_TEXT_MAX_LENGTH,
  REPEATED_CONTAINER_TEXT_MIN_COUNT,
  REPEATED_CONTAINER_TEXT_MIN_LENGTH,
} from "../../constants/design.js";
import { TAILWIND_NAMED_BREAKPOINTS } from "../../constants/tailwind.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getTailwindVisibilityAtBreakpoints } from "../../utils/get-tailwind-visibility-at-breakpoints.js";
import { getTailwindVisibilityEffect } from "../../utils/get-tailwind-visibility-effect.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { isTailwindCardSurface } from "./utils/is-tailwind-card-surface.js";

const REPEATED_TEXT_CONTAINER_NAMES = new Set(["article", "aside", "div", "section"]);
const REPEATED_TEXT_SKIPPED_NAMES = new Set([
  "a",
  "button",
  "canvas",
  "code",
  "datalist",
  "dd",
  "dl",
  "dt",
  "figure",
  "input",
  "kbd",
  "label",
  "menu",
  "nav",
  "ol",
  "option",
  "optgroup",
  "pre",
  "samp",
  "select",
  "summary",
  "svg",
  "table",
  "tbody",
  "td",
  "textarea",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
]);
const REPEATED_TEXT_SKIPPED_ROLES = new Set([
  "button",
  "cell",
  "grid",
  "gridcell",
  "graphics-document",
  "graphics-symbol",
  "img",
  "link",
  "list",
  "listbox",
  "listitem",
  "menu",
  "menubar",
  "navigation",
  "progressbar",
  "radiogroup",
  "row",
  "rowgroup",
  "table",
  "tablist",
  "tree",
  "treeitem",
  "diagram",
]);
const CONTENT_ATTRIBUTE_NAMES = new Set(["children", "dangerouslySetInnerHTML"]);
const DATA_VISUALIZATION_CLASS_PATTERN =
  /(?:^|[-_\s])(?:chart|graph|heatmap|plot|visualization)(?:$|[-_\s])/i;
const VISUALLY_HIDDEN_CLASS_NAMES = new Set(["screen-reader-only", "sr-only", "visually-hidden"]);
const VISUALLY_HIDDEN_UTILITY_NAMES = new Set(["not-sr-only", "sr-only"]);
const TAILWIND_NAMED_BREAKPOINT_SET = new Set(TAILWIND_NAMED_BREAKPOINTS);

interface RepeatedTextOccurrence {
  node: EsTreeNode;
  signature: string;
}

interface RepeatedTextCollection {
  descendantCount: number;
  isStatic: boolean;
  occurrencesByText: Map<string, RepeatedTextOccurrence[]>;
}

const getNativeElementName = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return null;
  const elementName = openingElement.name.name;
  return elementName === elementName.toLowerCase() ? elementName : null;
};

const hasContentAttribute = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  openingElement.attributes.some(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      CONTENT_ATTRIBUTE_NAMES.has(getJsxAttributeName(attribute.name) ?? ""),
  );

const isStaticallyHidden = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  classNameValue: string | null,
  context: RuleContext,
): boolean => {
  const hiddenAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "hidden");
  if (hiddenAttribute) {
    if (!hiddenAttribute.value) return true;
    const hiddenValue = getStringLiteralAttributeValue(hiddenAttribute);
    if (hiddenValue === null || hiddenValue.toLowerCase() !== "false") return true;
  }
  const ariaHiddenAttribute = getAuthoritativeJsxAttribute(
    openingElement.attributes,
    "aria-hidden",
  );
  if (ariaHiddenAttribute) {
    const ariaHiddenValue = getStringLiteralAttributeValue(ariaHiddenAttribute);
    if (ariaHiddenValue === null || ariaHiddenValue.toLowerCase() === "true") return true;
  }
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  if (styleAttribute) {
    const styleExpression = getInlineStyleExpression(styleAttribute, context.scopes);
    if (!styleExpression) return false;
    const displayProperty = getEffectiveStyleProperty(styleExpression.properties, "display");
    const visibilityProperty = getEffectiveStyleProperty(styleExpression.properties, "visibility");
    if (
      (displayProperty &&
        getStylePropertyStringValue(displayProperty)?.trim().toLowerCase() === "none") ||
      (visibilityProperty &&
        ["collapse", "hidden"].includes(
          getStylePropertyStringValue(visibilityProperty)?.trim().toLowerCase() ?? "",
        ))
    ) {
      return true;
    }
    if (
      (displayProperty && getStylePropertyStringValue(displayProperty) === null) ||
      (visibilityProperty && getStylePropertyStringValue(visibilityProperty) === null)
    ) {
      return true;
    }
  }
  if (!classNameValue) return false;
  const classNameTokens = splitTailwindClassName(classNameValue);
  if (classNameTokens.some((classNameToken) => VISUALLY_HIDDEN_CLASS_NAMES.has(classNameToken))) {
    return true;
  }
  const effectiveScreenReaderUtility = getEffectiveTailwindClassNameToken(
    classNameTokens,
    (utility) => VISUALLY_HIDDEN_UTILITY_NAMES.has(utility),
  );
  if (effectiveScreenReaderUtility === "sr-only") return true;
  const visibilityAtBreakpoints = getTailwindVisibilityAtBreakpoints(classNameValue);
  return visibilityAtBreakpoints?.every((isVisible) => !isVisible) ?? false;
};

const hasResponsiveVisibility = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  return splitTailwindClassName(classNameValue)
    .map(parseTailwindClassNameToken)
    .some(({ utility, variants }) => {
      const isVisibilityUtility =
        getTailwindVisibilityEffect(utility).status !== "not-relevant" ||
        VISUALLY_HIDDEN_UTILITY_NAMES.has(utility);
      if (!isVisibilityUtility) return false;
      return variants.some(
        (variant) =>
          TAILWIND_NAMED_BREAKPOINT_SET.has(variant) ||
          (variant.startsWith("max-") &&
            TAILWIND_NAMED_BREAKPOINT_SET.has(variant.slice("max-".length))) ||
          /^(?:min|max)-\[.+\]$/.test(variant),
      );
    });
};

const shouldSkipElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  isRoot: boolean,
  context: RuleContext,
): boolean => {
  const elementName = getNativeElementName(openingElement);
  if (!elementName || REPEATED_TEXT_SKIPPED_NAMES.has(elementName)) return true;
  if (hasJsxSpreadAttribute(openingElement.attributes) || hasContentAttribute(openingElement)) {
    return true;
  }
  const classNameAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "className");
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (classNameAttribute && classNameValue === null) return true;
  if (
    (classNameValue && DATA_VISUALIZATION_CLASS_PATTERN.test(classNameValue)) ||
    isStaticallyHidden(openingElement, classNameValue, context)
  ) {
    return true;
  }
  const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role");
  if (roleAttribute) {
    const role = getStringLiteralAttributeValue(roleAttribute)?.toLowerCase();
    if (!role || REPEATED_TEXT_SKIPPED_ROLES.has(role)) return true;
  }
  return !isRoot && isTailwindCardSurface(openingElement);
};

const getStructuralPathSegment = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): string | null => {
  const elementName = getNativeElementName(openingElement);
  if (!elementName) return null;
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return elementName;
  const normalizedClasses = splitTailwindClassName(classNameValue).sort().join(".");
  return normalizedClasses ? `${elementName}.${normalizedClasses}` : elementName;
};

const normalizeRepeatedText = (value: string): string | null => {
  const text = value.replace(/\s+/g, " ").trim();
  if (
    text.length < REPEATED_CONTAINER_TEXT_MIN_LENGTH ||
    text.length > REPEATED_CONTAINER_TEXT_MAX_LENGTH ||
    !/\p{L}/u.test(text)
  ) {
    return null;
  }
  return text;
};

const appendTextOccurrence = (
  collection: RepeatedTextCollection,
  value: string,
  node: EsTreeNode,
  structuralPath: string[],
): void => {
  const text = normalizeRepeatedText(value);
  if (!text) return;
  const occurrences = collection.occurrencesByText.get(text) ?? [];
  occurrences.push({ node, signature: structuralPath.join(">") });
  collection.occurrencesByText.set(text, occurrences);
};

const collectStaticChild = (
  node: EsTreeNode,
  structuralPath: string[],
  collection: RepeatedTextCollection,
  context: RuleContext,
): void => {
  if (!collection.isStatic) return;
  if (isNodeOfType(node, "JSXText")) {
    appendTextOccurrence(collection, node.value ?? "", node, structuralPath);
    return;
  }
  if (isNodeOfType(node, "JSXElement")) {
    if (shouldSkipElement(node.openingElement, false, context)) return;
    collection.descendantCount += 1;
    if (collection.descendantCount > REPEATED_CONTAINER_TEXT_MAX_DESCENDANT_COUNT) {
      collection.isStatic = false;
      return;
    }
    if (hasResponsiveVisibility(node.openingElement)) {
      collection.isStatic = false;
      return;
    }
    const pathSegment = getStructuralPathSegment(node.openingElement);
    if (!pathSegment) return;
    const nextStructuralPath = [...structuralPath, pathSegment];
    for (const child of node.children) {
      collectStaticChild(child, nextStructuralPath, collection, context);
    }
    return;
  }
  if (isNodeOfType(node, "JSXFragment")) {
    for (const child of node.children) {
      collectStaticChild(child, structuralPath, collection, context);
    }
    return;
  }
  if (!isNodeOfType(node, "JSXExpressionContainer")) {
    collection.isStatic = false;
    return;
  }
  const expression = node.expression;
  if (isNodeOfType(expression, "Literal")) {
    if (typeof expression.value === "string") {
      appendTextOccurrence(collection, expression.value, expression, structuralPath);
    }
    return;
  }
  if (
    isNodeOfType(expression, "TemplateLiteral") &&
    expression.expressions.length === 0 &&
    expression.quasis.length === 1
  ) {
    appendTextOccurrence(
      collection,
      expression.quasis[0].value.cooked ?? expression.quasis[0].value.raw,
      expression,
      structuralPath,
    );
    return;
  }
  if (!isNodeOfType(expression, "JSXEmptyExpression")) collection.isStatic = false;
};

const collectRepeatedText = (
  container: EsTreeNodeOfType<"JSXElement">,
  context: RuleContext,
): RepeatedTextCollection | null => {
  if (
    hasResponsiveVisibility(container.openingElement) ||
    shouldSkipElement(container.openingElement, true, context)
  ) {
    return null;
  }
  const collection: RepeatedTextCollection = {
    descendantCount: 0,
    isStatic: true,
    occurrencesByText: new Map(),
  };
  for (const child of container.children) collectStaticChild(child, [], collection, context);
  return collection.isStatic ? collection : null;
};

export const noRepeatedContainerText = defineRule({
  id: "no-repeated-container-text",
  title: "A card repeats the same text in distinct slots",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  category: "Design",
  recommendation:
    "Keep repeated status or label copy in the one card slot where it carries the clearest meaning.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !hasCapabilityOrUnspecified(context.settings, "tailwind") ||
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        !REPEATED_TEXT_CONTAINER_NAMES.has(node.openingElement.name.name) ||
        !isTailwindCardSurface(node.openingElement)
      ) {
        return;
      }
      const collection = collectRepeatedText(node, context);
      if (!collection) return;
      for (const [text, occurrences] of collection.occurrencesByText) {
        const distinctSignatures = new Set(occurrences.map((occurrence) => occurrence.signature));
        if (
          occurrences.length < REPEATED_CONTAINER_TEXT_MIN_COUNT ||
          distinctSignatures.size < REPEATED_CONTAINER_TEXT_MIN_COUNT
        ) {
          continue;
        }
        context.report({
          node: occurrences[0].node,
          message: `The literal "${text}" appears in ${distinctSignatures.size} structurally different spots inside this card. Keep it in the one slot where it matters most.`,
        });
      }
    },
  }),
});
