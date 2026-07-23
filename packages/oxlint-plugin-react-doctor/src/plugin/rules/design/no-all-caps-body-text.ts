import { LONG_BODY_TEXT_MIN_CHARACTERS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveStyleProperty } from "./utils/get-effective-style-property.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const BODY_TEXT_ELEMENT_NAMES = new Set(["blockquote", "dd", "figcaption", "li", "p", "td"]);
const CASED_LETTER_PATTERN = /[\p{Lu}\p{Ll}\p{Lt}]/u;
const UPPERCASE_LETTER_PATTERN = /\p{Lu}/u;

const hasUppercaseStyle = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(node);
  if (classNameValue && getUnvariantClassNameTokens(classNameValue).includes("uppercase")) {
    return true;
  }
  for (const attribute of node.attributes ?? []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const styleExpression = getInlineStyleExpression(attribute);
    if (!styleExpression) continue;
    const property = getEffectiveStyleProperty(styleExpression.properties, "textTransform");
    if (property && getStylePropertyStringValue(property)?.toLowerCase() === "uppercase")
      return true;
  }
  return false;
};

export const noAllCapsBodyText = defineRule({
  id: "no-all-caps-body-text",
  title: "Long body copy is set in all caps",
  severity: "warn",
  tags: ["design", "test-noise"],
  category: "Accessibility",
  recommendation:
    "Use sentence case for paragraphs and reserve uppercase styling for short labels.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return;
      if (!BODY_TEXT_ELEMENT_NAMES.has(openingElement.name.name)) return;
      const staticText = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (
        staticText.length < LONG_BODY_TEXT_MIN_CHARACTERS ||
        !CASED_LETTER_PATTERN.test(staticText)
      ) {
        return;
      }
      const isLiteralUppercase =
        UPPERCASE_LETTER_PATTERN.test(staticText) && staticText === staticText.toUpperCase();
      if (!isLiteralUppercase && !hasUppercaseStyle(openingElement)) return;
      context.report({
        node: openingElement,
        message:
          "Long all-caps copy is difficult to scan. Use sentence case here and keep uppercase treatment for compact labels.",
      });
    },
  }),
});
