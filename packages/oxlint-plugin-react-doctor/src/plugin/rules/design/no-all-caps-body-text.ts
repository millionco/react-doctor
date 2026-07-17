import { LONG_BODY_TEXT_MIN_CHARACTERS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getClassNameTokens } from "../../utils/get-class-name-tokens.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getInlineStyleExpression } from "./utils/get-inline-style-expression.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getStylePropertyKey } from "./utils/get-style-property-key.js";
import { getStylePropertyStringValue } from "./utils/get-style-property-string-value.js";

const BODY_TEXT_ELEMENT_NAMES = new Set(["blockquote", "dd", "figcaption", "li", "p", "td"]);
const LETTER_PATTERN = /\p{L}/u;
const LOWERCASE_LETTER_PATTERN = /\p{Ll}/u;

const hasUppercaseStyle = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const classNameValue = getStringFromClassNameAttr(node);
  if (classNameValue && getClassNameTokens(classNameValue).includes("uppercase")) return true;
  for (const attribute of node.attributes ?? []) {
    if (!isNodeOfType(attribute, "JSXAttribute")) continue;
    const styleExpression = getInlineStyleExpression(attribute);
    if (!styleExpression) continue;
    if (
      styleExpression.properties?.some(
        (property) =>
          getStylePropertyKey(property) === "textTransform" &&
          getStylePropertyStringValue(property)?.toLowerCase() === "uppercase",
      )
    ) {
      return true;
    }
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
      if (staticText.length < LONG_BODY_TEXT_MIN_CHARACTERS || !LETTER_PATTERN.test(staticText)) {
        return;
      }
      const isLiteralUppercase = !LOWERCASE_LETTER_PATTERN.test(staticText);
      if (!isLiteralUppercase && !hasUppercaseStyle(openingElement)) return;
      context.report({
        node: openingElement,
        message:
          "Long all-caps copy is difficult to scan. Use sentence case here and keep uppercase treatment for compact labels.",
      });
    },
  }),
});
