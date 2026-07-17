import { LONG_ALL_CAPS_HEADING_MIN_CHARACTERS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";

const HEADING_ELEMENT_PATTERN = /^h[1-6]$/;
const LETTER_PATTERN = /\p{L}/u;
const LOWERCASE_LETTER_PATTERN = /\p{Ll}/u;
const ARBITRARY_TIGHT_LEADING_PATTERN = /^leading-\[(?:0(?:\.\d+)?|\.\d+)\]$/;

export const noTightAllCapsHeading = defineRule({
  id: "no-tight-all-caps-heading",
  title: "Long all-caps heading has collision-prone leading",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Use at least 1.0 line-height for an all-caps display heading that can wrap, or switch the heading to ordinary casing.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      const openingElement = node.openingElement;
      if (
        !isNodeOfType(openingElement.name, "JSXIdentifier") ||
        !HEADING_ELEMENT_PATTERN.test(openingElement.name.name)
      ) {
        return;
      }
      const text = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (text.length < LONG_ALL_CAPS_HEADING_MIN_CHARACTERS || !LETTER_PATTERN.test(text)) return;
      const classNameValue = getStringFromClassNameAttr(openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokens(classNameValue);
      const isAllCaps = tokens.includes("uppercase") || !LOWERCASE_LETTER_PATTERN.test(text);
      const hasTightLeading =
        tokens.includes("leading-none") ||
        tokens.some((token) => ARBITRARY_TIGHT_LEADING_PATTERN.test(token));
      if (!isAllCaps || !hasTightLeading) return;
      context.report({
        node: openingElement,
        message:
          "This long all-caps heading can wrap with less than 1.0 line-height, causing adjacent capital lines to collide. Increase the leading or use ordinary casing.",
      });
    },
  }),
});
