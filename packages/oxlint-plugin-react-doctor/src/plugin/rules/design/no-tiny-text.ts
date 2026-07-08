import { TINY_TEXT_THRESHOLD_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

const LETTER_OR_DIGIT_PATTERN = /[\p{L}\p{N}]/u;

// JSX keeps `&#x2713;` as raw text — decode numeric entities (and the
// common named glyph ones) so a checkmark entity is recognized as a
// glyph, not read as the letters "x2713".
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

const collectStaticExpressionText = (node: EsTreeNode | null | undefined): string => {
  if (!node) return "";
  if (isNodeOfType(node, "Literal")) {
    return typeof node.value === "string" ? node.value : "";
  }
  if (isNodeOfType(node, "TemplateLiteral")) {
    return (node.quasis ?? []).map((quasi) => quasi.value?.raw ?? "").join("");
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      collectStaticExpressionText(node.consequent) + collectStaticExpressionText(node.alternate)
    );
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    return collectStaticExpressionText(node.right);
  }
  return "";
};

const ICON_IDENTIFIER_NAME_PATTERN = /icon|glyph/i;

// `{isHovered ? icon : null}` — content that resolves only to bindings
// NAMED icon/glyph is decorative glyph sizing, not readable text.
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

const hasOnlyIconIdentifierChildren = (
  styleAttribute: EsTreeNodeOfType<"JSXAttribute">,
): boolean => {
  const jsxElement = styleAttribute.parent?.parent;
  if (!isNodeOfType(jsxElement, "JSXElement")) return false;
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

// `<FaPlay style={{ fontSize: 8 }} />` — a childless icon COMPONENT
// (react-icons naming or an *Icon* name) uses font-size purely for
// glyph dimensions.
const REACT_ICONS_COMPONENT_NAME_PATTERN =
  /^(?:Fa|Md|Io|Bs|Bi|Ri|Gi|Hi|Lu|Tb|Fi|Ai|Cg|Di|Gr|Im|Pi|Si|Sl|Ti|Vsc|Wi)[A-Z0-9]/;
const ICON_WORD_PATTERN = /icon/i;

const isChildlessIconComponent = (styleAttribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const openingElement = styleAttribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
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

// Decorative glyph content (sort arrows `▲`/`▼`, `×` close marks, `#`
// column headers) is sized with fontSize but is not text users read.
const hasGlyphOnlyContent = (styleAttribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const jsxElement = styleAttribute.parent?.parent;
  if (!isNodeOfType(jsxElement, "JSXElement")) return false;
  let staticText = "";
  for (const child of jsxElement.children ?? []) {
    if (isNodeOfType(child, "JSXText")) {
      staticText += typeof child.value === "string" ? child.value : "";
    } else if (isNodeOfType(child, "JSXExpressionContainer")) {
      staticText += collectStaticExpressionText(child.expression);
    }
  }
  const trimmedText = decodeHtmlEntities(staticText.trim());
  return trimmedText.length > 0 && !LETTER_OR_DIGIT_PATTERN.test(trimmedText);
};

// Uppercase tracked micro-labels (overlines / eyebrow headers) are a
// deliberate design pattern, not body text — uppercase glyphs read
// larger than lowercase at the same px size.
const isUppercaseMicroLabel = (expression: EsTreeNodeOfType<"ObjectExpression">): boolean =>
  (expression.properties ?? []).some(
    (property) =>
      getStylePropertyKey(property) === "textTransform" &&
      getStylePropertyStringValue(property) === "uppercase",
  );

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
    return {
      JSXAttribute(node: EsTreeNodeOfType<"JSXAttribute">) {
        const expression = getInlineStyleExpression(node);
        if (!expression) return;

        for (const property of expression.properties ?? []) {
          const key = getStylePropertyKey(property);
          if (key !== "fontSize") continue;

          let pxValue: number | null = null;
          const numValue = getStylePropertyNumberValue(property);
          const strValue = getStylePropertyStringValue(property);

          if (numValue !== null) {
            pxValue = numValue;
          } else if (strValue !== null) {
            const pxMatch = strValue.match(/^([\d.]+)px$/);
            if (pxMatch) pxValue = parseFloat(pxMatch[1]);
            const remMatch = strValue.match(/^([\d.]+)rem$/);
            if (remMatch) pxValue = parseFloat(remMatch[1]) * 16;
          }

          if (pxValue === null || pxValue <= 0 || pxValue >= TINY_TEXT_THRESHOLD_PX) continue;
          if (reportedPxValues.has(pxValue)) continue;
          if (isUppercaseMicroLabel(expression)) continue;
          if (hasGlyphOnlyContent(node)) continue;
          if (hasOnlyIconIdentifierChildren(node)) continue;
          if (isChildlessIconComponent(node)) continue;

          reportedPxValues.add(pxValue);
          context.report({
            node: property,
            message: `Your users strain to read ${pxValue}px text, so use at least ${TINY_TEXT_THRESHOLD_PX}px for body text, & 16px is best.`,
          });
        }
      },
    };
  },
});
