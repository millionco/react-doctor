import { TINY_TEXT_THRESHOLD_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getTailwindVisibilityAtBreakpoints } from "../../utils/get-tailwind-visibility-at-breakpoints.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { hasCapabilityOrUnspecified } from "../../utils/get-react-doctor-setting.js";
import { isHiddenFromScreenReader } from "../../utils/is-hidden-from-screen-reader.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { parseTailwindClassNameToken } from "../../utils/parse-tailwind-class-name-token.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import { splitTailwindClassName } from "../../utils/split-tailwind-class-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveNonzeroTailwindTracking } from "./utils/get-effective-nonzero-tailwind-tracking.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStaticEffectiveFontSize } from "./utils/get-static-effective-font-size.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const LETTER_OR_DIGIT_PATTERN = /[\p{L}\p{N}]/u;
const NAMED_GLYPH_ENTITY_CHARS: Record<string, string> = {
  times: "×",
  middot: "·",
  bull: "•",
  hellip: "…",
  rarr: "→",
  larr: "←",
  uarr: "↑",
  darr: "↓",
  nbsp: "\u00a0",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  lsaquo: "‹",
  rsaquo: "›",
  deg: "°",
  check: "✓",
};

const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hexCode: string) =>
      String.fromCodePoint(Number.parseInt(hexCode, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimalCode: string) =>
      String.fromCodePoint(Number.parseInt(decimalCode, 10)),
    )
    .replace(
      /&([a-z]+);/gi,
      (match, entityName: string) => NAMED_GLYPH_ENTITY_CHARS[entityName.toLowerCase()] ?? match,
    );

const collectStaticExpressionText = (node: EsTreeNode | null | undefined): string | null => {
  if (!node) return null;
  if (isNodeOfType(node, "Literal")) {
    if (node.value === null || typeof node.value === "boolean") return "";
    return typeof node.value === "string" || typeof node.value === "number"
      ? String(node.value)
      : null;
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    if (node.expressions.length > 0) return null;
    return (node.quasis ?? []).map((quasi) => quasi.value?.raw ?? "").join("");
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    const consequentText = collectStaticExpressionText(node.consequent);
    const alternateText = collectStaticExpressionText(node.alternate);
    return consequentText === null || alternateText === null
      ? null
      : consequentText + alternateText;
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    return collectStaticExpressionText(node.right);
  }
  return null;
};

const ICON_IDENTIFIER_NAME_PATTERN = /icon|glyph/i;
const isIconIdentifierExpression = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  if (isNodeOfType(node, "Literal")) return node.value === null || node.value === "";
  if (isNodeOfType(node, "Identifier")) return ICON_IDENTIFIER_NAME_PATTERN.test(node.name);
  if (isNodeOfType(node, "MemberExpression") && isNodeOfType(node.property, "Identifier")) {
    return ICON_IDENTIFIER_NAME_PATTERN.test(node.property.name);
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      isIconIdentifierExpression(node.consequent) && isIconIdentifierExpression(node.alternate)
    );
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    return isIconIdentifierExpression(node.right);
  }
  return false;
};

const hasOnlyIconIdentifierChildren = (jsxElement: EsTreeNodeOfType<"JSXElement">): boolean => {
  let expressionChildCount = 0;
  for (const child of jsxElement.children ?? []) {
    if (isNodeOfType(child, "JSXText")) {
      if ((child.value ?? "").trim().length > 0) return false;
      continue;
    }
    if (!isNodeOfType(child, "JSXExpressionContainer")) return false;
    if (!isIconIdentifierExpression(child.expression)) return false;
    expressionChildCount += 1;
  }
  return expressionChildCount > 0;
};

const REACT_ICONS_COMPONENT_NAME_PATTERN =
  /^(?:Fa|Md|Io|Bs|Bi|Ri|Gi|Hi|Lu|Tb|Fi|Ai|Cg|Di|Gr|Im|Pi|Si|Sl|Ti|Vsc|Wi)[A-Z0-9]/;
const ICON_WORD_PATTERN = /icon/i;

const isChildlessIconComponent = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return false;
  const elementName = openingElement.name.name;
  if (!/^[A-Z]/.test(elementName)) return false;
  if (
    !REACT_ICONS_COMPONENT_NAME_PATTERN.test(elementName) &&
    !ICON_WORD_PATTERN.test(elementName)
  ) {
    return false;
  }
  const jsxElement = openingElement.parent;
  if (!isNodeOfType(jsxElement, "JSXElement")) return true;
  return (jsxElement.children ?? []).every(
    (child: EsTreeNode) => isNodeOfType(child, "JSXText") && (child.value ?? "").trim() === "",
  );
};

const hasGlyphOnlyContent = (jsxElement: EsTreeNodeOfType<"JSXElement">): boolean => {
  let staticText = "";
  for (const child of jsxElement.children ?? []) {
    if (isNodeOfType(child, "JSXText")) {
      staticText += typeof child.value === "string" ? child.value : "";
    } else if (isNodeOfType(child, "JSXExpressionContainer")) {
      if (isIconIdentifierExpression(child.expression)) continue;
      const expressionText = collectStaticExpressionText(child.expression);
      if (expressionText === null) return false;
      staticText += expressionText;
    }
  }
  const trimmedText = decodeHtmlEntities(staticText.trim());
  return trimmedText.length > 0 && !LETTER_OR_DIGIT_PATTERN.test(trimmedText);
};

const PREFORMATTED_ELEMENT_NAMES = new Set([
  "code",
  "head",
  "kbd",
  "noscript",
  "option",
  "pre",
  "samp",
  "script",
  "style",
  "sub",
  "sup",
  "svg",
  "template",
  "title",
  "var",
]);
const FUNCTIONAL_ELEMENT_NAMES = new Set([
  "a",
  "button",
  "caption",
  "dd",
  "dt",
  "figcaption",
  "footer",
  "label",
  "nav",
  "summary",
  "td",
  "th",
  "time",
]);
const FUNCTIONAL_ROLE_NAMES = new Set([
  "button",
  "cell",
  "checkbox",
  "columnheader",
  "gridcell",
  "link",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "navigation",
  "option",
  "radio",
  "rowheader",
  "switch",
  "tab",
  "treeitem",
]);
const FUNCTIONAL_CLASS_NAME_PATTERN =
  /^(?:badge|breadcrumb|caption|category|chip|eyebrow|kicker|label|meta|nav|pill|tag|timestamp)(?:$|-)/i;
const PREFORMATTED_CLASS_NAME_PATTERN = /^(?:code|console|diff|editor|syntax|terminal)(?:$|-)/i;
const PREFORMATTED_COMPONENT_NAME_PATTERN =
  /^(?:(?:Code|Console|Diff|Editor|Syntax|Terminal)(?:Block|Output|Pane|Renderer|View|Viewer)?|SyntaxHighlighter)$/;
const VISUALLY_HIDDEN_CLASS_NAMES = new Set([
  "a11y-hidden",
  "hidden-visually",
  "offscreen",
  "screen-reader",
  "screen-reader-only",
  "screenreader",
  "sr-only",
  "visually-hidden",
  "visuallyhidden",
]);
const CASE_TOKENS = new Set(["capitalize", "lowercase", "normal-case", "uppercase"]);

const getAncestorOpeningElements = (
  jsxElement: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXOpeningElement">[] => {
  const openingElements: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
  let currentNode: EsTreeNode | null | undefined = jsxElement;
  while (currentNode) {
    if (isNodeOfType(currentNode, "JSXElement")) {
      openingElements.push(currentNode.openingElement);
    }
    currentNode = currentNode.parent;
  }
  return openingElements;
};

const hasUnresolvedVisibilityAttribute = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  for (const attributeName of ["hidden", "aria-hidden"]) {
    const attribute = getAuthoritativeJsxAttribute(openingElement.attributes, attributeName, false);
    if (
      attribute?.value &&
      isNodeOfType(attribute.value, "JSXExpressionContainer") &&
      !isNodeOfType(attribute.value.expression, "Literal") &&
      (!isNodeOfType(attribute.value.expression, "TemplateLiteral") ||
        attribute.value.expression.expressions.length > 0)
    ) {
      return true;
    }
  }
  return false;
};

const hasUnresolvedClassName = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  Boolean(
    getAuthoritativeJsxAttribute(openingElement.attributes, "className") &&
    getStringFromClassNameAttr(openingElement) === null,
  );

const hasUnresolvedInlineVisibility = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  if (!styleAttribute) return false;
  const expression = getInlineStyleExpression(styleAttribute);
  if (!expression) return true;
  if (expression.properties.some((property) => getStylePropertyKey(property) === null)) return true;
  for (const propertyName of ["display", "visibility"]) {
    const property = getEffectiveStyleProperty(expression.properties, propertyName);
    if (property && getStylePropertyStringValue(property) === null) return true;
  }
  return false;
};

const hasUnresolvedRenderingState = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean =>
  hasJsxSpreadAttribute(openingElement.attributes) ||
  hasUnresolvedVisibilityAttribute(openingElement) ||
  hasUnresolvedClassName(openingElement) ||
  hasUnresolvedInlineVisibility(openingElement);

const isStaticallyNonRendered = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  hasTailwind: boolean,
): boolean => {
  const hiddenAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "hidden", false);
  if (hiddenAttribute && getStringLiteralAttributeValue(hiddenAttribute) !== null) return true;
  if (isHiddenFromScreenReader(openingElement, undefined)) return true;
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  const expression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
  if (expression) {
    const displayProperty = getEffectiveStyleProperty(expression.properties, "display");
    if (displayProperty && getStylePropertyStringValue(displayProperty)?.toLowerCase() === "none") {
      return true;
    }
    const visibilityProperty = getEffectiveStyleProperty(expression.properties, "visibility");
    const visibilityValue = visibilityProperty
      ? getStylePropertyStringValue(visibilityProperty)?.toLowerCase()
      : null;
    if (visibilityValue === "hidden" || visibilityValue === "collapse") return true;
  }
  if (!hasTailwind) return false;
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const visibilityAtBreakpoints = getTailwindVisibilityAtBreakpoints(classNameValue);
  return Boolean(
    visibilityAtBreakpoints && visibilityAtBreakpoints.every((isVisible) => !isVisible),
  );
};

const isVisuallyHidden = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const tokens = splitTailwindClassName(classNameValue).map(parseTailwindClassNameToken);
  const hasImportantScreenReaderOnly = tokens.some(
    (token) => token.utility === "sr-only" && token.isImportant,
  );
  const hasImportantVisibleOverride = tokens.some(
    (token) => token.utility === "not-sr-only" && token.isImportant,
  );
  if (hasImportantScreenReaderOnly && !hasImportantVisibleOverride) return true;
  if (tokens.some((token) => token.utility === "not-sr-only")) return false;
  return tokens.some((token) => VISUALLY_HIDDEN_CLASS_NAMES.has(token.utility.toLowerCase()));
};

const isPreformattedContext = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const elementName = resolveJsxElementType(openingElement);
  if (
    PREFORMATTED_ELEMENT_NAMES.has(elementName.toLowerCase()) ||
    PREFORMATTED_COMPONENT_NAME_PATTERN.test(elementName)
  ) {
    return true;
  }
  const classNameValue = getStringFromClassNameAttr(openingElement);
  return Boolean(
    classNameValue &&
    splitTailwindClassName(classNameValue)
      .map(parseTailwindClassNameToken)
      .some((token) => PREFORMATTED_CLASS_NAME_PATTERN.test(token.utility)),
  );
};

const isFunctionalTextContext = (
  openingElements: ReadonlyArray<EsTreeNodeOfType<"JSXOpeningElement">>,
): boolean =>
  openingElements.some((openingElement) => {
    const elementName = resolveJsxElementType(openingElement).toLowerCase();
    if (FUNCTIONAL_ELEMENT_NAMES.has(elementName)) return true;
    const roleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "role", false);
    const roleValue = roleAttribute ? getStringLiteralAttributeValue(roleAttribute) : null;
    if (roleValue && FUNCTIONAL_ROLE_NAMES.has(roleValue.toLowerCase())) return true;
    const classNameValue = getStringFromClassNameAttr(openingElement);
    return Boolean(
      classNameValue &&
      splitTailwindClassName(classNameValue)
        .map(parseTailwindClassNameToken)
        .some((token) => FUNCTIONAL_CLASS_NAME_PATTERN.test(token.utility)),
    );
  });

const hasNonzeroInlineLetterSpacing = (
  expression: EsTreeNodeOfType<"ObjectExpression">,
): boolean => {
  const property = getEffectiveStyleProperty(expression.properties, "letterSpacing");
  if (!property) return false;
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue !== 0;
  const stringValue = getStylePropertyStringValue(property);
  if (!stringValue || stringValue === "normal") return false;
  const parsedValue = Number.parseFloat(stringValue);
  return Number.isFinite(parsedValue) && parsedValue !== 0;
};

const isUppercaseTrackedMicroLabel = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
): boolean => {
  const styleAttribute = getAuthoritativeJsxAttribute(openingElement.attributes, "style");
  const expression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
  if (expression) {
    const textTransformProperty = getEffectiveStyleProperty(expression.properties, "textTransform");
    if (
      textTransformProperty &&
      getStylePropertyStringValue(textTransformProperty) === "uppercase" &&
      hasNonzeroInlineLetterSpacing(expression)
    ) {
      return true;
    }
  }
  const classNameValue = getStringFromClassNameAttr(openingElement);
  if (!classNameValue) return false;
  const tokens = getUnvariantClassNameTokensWithImportantModifiers(classNameValue);
  return (
    getEffectiveTailwindClassNameToken(tokens, (utility) => CASE_TOKENS.has(utility)) ===
      "uppercase" && Boolean(getEffectiveNonzeroTailwindTracking(tokens))
  );
};

export const noTinyText = defineRule({
  id: "no-tiny-text",
  title: "Text is too small",
  severity: "warn",
  tags: ["test-noise"],
  category: "Accessibility",
  recommendation:
    "Use at least 12px for body text, and 16px is best. Small text is hard to read, especially on phones.",
  create: (context: RuleContext) => {
    const reportedPxValues = new Set<number>();
    const hasTailwind = hasCapabilityOrUnspecified(context.settings, "tailwind");
    return {
      JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
        const openingElement = node.openingElement;
        const openingElements = getAncestorOpeningElements(node);
        if (openingElements.some(hasUnresolvedRenderingState)) return;
        if (
          openingElements.some(
            (ancestorOpeningElement) =>
              isStaticallyNonRendered(ancestorOpeningElement, hasTailwind) ||
              isVisuallyHidden(ancestorOpeningElement) ||
              isPreformattedContext(ancestorOpeningElement),
          )
        ) {
          return;
        }
        const pxValue = getStaticEffectiveFontSize(openingElement, hasTailwind);
        if (
          pxValue === null ||
          pxValue <= 0 ||
          pxValue >= TINY_TEXT_THRESHOLD_PX ||
          reportedPxValues.has(pxValue) ||
          hasGlyphOnlyContent(node) ||
          hasOnlyIconIdentifierChildren(node) ||
          isChildlessIconComponent(openingElement) ||
          (isUppercaseTrackedMicroLabel(openingElement) &&
            !isFunctionalTextContext(openingElements))
        ) {
          return;
        }
        reportedPxValues.add(pxValue);
        context.report({
          node: openingElement,
          message: `Your users strain to read ${pxValue}px text, so use at least ${TINY_TEXT_THRESHOLD_PX}px for readable interface text, & 16px is best.`,
        });
      },
    };
  },
});
