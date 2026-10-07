import { SHORT_DECORATIVE_LABEL_MAX_CHARACTERS } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getEffectiveNonzeroTailwindTracking } from "./utils/get-effective-nonzero-tailwind-tracking.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { isTechnicalLabelText } from "./utils/is-technical-label-text.js";

const PREFORMATTED_ELEMENT_NAMES = new Set(["code", "kbd", "pre", "samp", "var"]);
const CASE_TOKENS = new Set(["capitalize", "lowercase", "normal-case", "uppercase"]);
const FONT_FAMILY_TOKENS = new Set(["font-mono", "font-sans", "font-serif"]);

export const noUppercaseMonoLabel = defineRule({
  id: "no-uppercase-mono-label",
  title: "Short label uses uppercase monospace styling",
  severity: "warn",
  defaultEnabled: false,
  requires: ["tailwind"],
  tags: ["design", "test-noise"],
  recommendation:
    "Use the interface typeface and ordinary casing for labels; reserve monospace for values that are genuinely code-like.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        node.openingElement.name.name !== node.openingElement.name.name.toLowerCase() ||
        PREFORMATTED_ELEMENT_NAMES.has(node.openingElement.name.name) ||
        hasJsxSpreadAttribute(node.openingElement.attributes) ||
        getAuthoritativeJsxAttribute(node.openingElement.attributes, "style")
      ) {
        return;
      }
      if (node.children.some((child) => isNodeOfType(child, "JSXExpressionContainer"))) return;
      const text = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      if (
        !text ||
        text.length > SHORT_DECORATIVE_LABEL_MAX_CHARACTERS ||
        isTechnicalLabelText(text)
      ) {
        return;
      }
      const classNameValue = getStringFromClassNameAttr(node.openingElement);
      if (!classNameValue) return;
      const tokens = getUnvariantClassNameTokensWithImportantModifiers(classNameValue);
      if (
        getEffectiveTailwindClassNameToken(tokens, (token) => FONT_FAMILY_TOKENS.has(token)) !==
          "font-mono" ||
        getEffectiveTailwindClassNameToken(tokens, (token) => CASE_TOKENS.has(token)) !==
          "uppercase" ||
        !getEffectiveNonzeroTailwindTracking(tokens)
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This short label combines uppercase and monospace as a decorative technical motif. Use normal interface typography unless the content is actually code.",
      });
    },
  }),
});
