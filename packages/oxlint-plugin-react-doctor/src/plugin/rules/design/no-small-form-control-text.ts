import { ROOT_FONT_SIZE_PX, TAILWIND_TEXT_SIZE_PX } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getStringLiteralAttributeValue } from "../../utils/get-string-literal-attribute-value.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveJsxElementType } from "../../utils/resolve-jsx-element-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyNumberValue } from "./utils/get-style-property-number-value.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const FORM_CONTROL_TAG_NAMES = new Set(["input", "select", "textarea"]);
const TEXTUAL_INPUT_TYPES = new Set([
  "date",
  "datetime-local",
  "email",
  "month",
  "number",
  "password",
  "search",
  "tel",
  "text",
  "time",
  "url",
  "week",
]);

const parseFontSize = (property: EsTreeNode): number | null => {
  const numberValue = getStylePropertyNumberValue(property);
  if (numberValue !== null) return numberValue;
  const stringValue = getStylePropertyStringValue(property);
  if (!stringValue) return null;
  const match = stringValue.match(/^([\d.]+)(px|rem)$/);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  return match[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
};

const parseTailwindFontSize = (token: string): number | null => {
  const standardSize = TAILWIND_TEXT_SIZE_PX.get(token);
  if (standardSize !== undefined) return standardSize;
  const arbitrarySize = token.match(/^text-\[([\d.]+)(px|rem)\]$/);
  if (!arbitrarySize) return null;
  const value = Number.parseFloat(arbitrarySize[1]);
  return arbitrarySize[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
};

const getStaticTailwindFontSize = (className: string | null): number | null => {
  if (!className) return null;
  let fontSize: number | null = null;
  for (const token of getUnvariantClassNameTokens(className)) {
    const currentSize = parseTailwindFontSize(token);
    if (currentSize !== null) fontSize = currentSize;
  }
  return fontSize;
};

export const noSmallFormControlText = defineRule({
  id: "no-small-form-control-text",
  title: "Form control text is smaller than 16px",
  severity: "warn",
  category: "Accessibility",
  defaultEnabled: false,
  recommendation:
    "Use at least 16px text on mobile inputs, selects, and textareas so content remains readable and mobile browsers do not zoom unexpectedly.",
  create: (context: RuleContext) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      const tagName = resolveJsxElementType(node);
      if (!FORM_CONTROL_TAG_NAMES.has(tagName) || hasJsxSpreadAttribute(node.attributes)) return;
      const typeAttribute = findJsxAttribute(node.attributes, "type");
      if (tagName === "input" && typeAttribute) {
        const inputType = getStringLiteralAttributeValue(typeAttribute)?.toLowerCase();
        if (!inputType || !TEXTUAL_INPUT_TYPES.has(inputType)) return;
      }
      const styleAttribute = findJsxAttribute(node.attributes, "style");
      const expression = styleAttribute ? getInlineStyleExpression(styleAttribute) : null;
      const inlineProperty = expression
        ? getEffectiveStyleProperty(expression.properties, "fontSize")
        : null;
      const inlineSize = inlineProperty ? parseFontSize(inlineProperty) : null;
      const tailwindSize = getStaticTailwindFontSize(getStringFromClassNameAttr(node));
      const effectiveSize = inlineSize ?? tailwindSize;
      if (effectiveSize === null || effectiveSize <= 0 || effectiveSize >= ROOT_FONT_SIZE_PX) {
        return;
      }
      const reportNode: EsTreeNode = inlineProperty ?? node;
      if (!isNodeOfType(reportNode, "Property") && !isNodeOfType(reportNode, "JSXOpeningElement"))
        return;
      context.report({
        node: reportNode,
        message: `This ${tagName} uses ${effectiveSize}px text on mobile. Use at least ${ROOT_FONT_SIZE_PX}px for readable controls and stable mobile focus.`,
      });
    },
  }),
});
