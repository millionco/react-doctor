import {
  SHORT_DECORATIVE_LABEL_MAX_CHARACTERS,
  TINY_UPPERCASE_TRACKED_LABEL_MAX_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokensWithImportantModifiers } from "../../utils/get-unvariant-class-name-tokens-with-important-modifiers.js";
import { getAuthoritativeJsxAttribute } from "../../utils/get-authoritative-jsx-attribute.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getEffectiveNonzeroTailwindTracking } from "./utils/get-effective-nonzero-tailwind-tracking.js";
import { getEffectiveTailwindClassNameToken } from "./utils/get-effective-tailwind-class-name-token.js";
import { getStaticTailwindFontSize } from "./utils/get-static-tailwind-font-size.js";
import { isTechnicalLabelText } from "./utils/is-technical-label-text.js";

const PREFORMATTED_ELEMENT_NAMES = new Set(["code", "kbd", "pre", "samp", "var"]);
const CASE_TOKENS = new Set(["capitalize", "lowercase", "normal-case", "uppercase"]);
export const noTinyUppercaseTrackedLabel = defineRule({
  id: "no-tiny-uppercase-tracked-label",
  title: "Tiny label combines uppercase text and decorative tracking",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise", "react-jsx-only"],
  requires: ["tailwind"],
  recommendation:
    "Use ordinary interface casing at a readable size instead of shrinking and spacing out short labels.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (
        !isNodeOfType(node.openingElement.name, "JSXIdentifier") ||
        node.openingElement.name.name !== node.openingElement.name.name.toLowerCase() ||
        PREFORMATTED_ELEMENT_NAMES.has(node.openingElement.name.name) ||
        hasJsxSpreadAttribute(node.openingElement.attributes) ||
        getAuthoritativeJsxAttribute(node.openingElement.attributes, "style") ||
        node.children.some((childNode) => isNodeOfType(childNode, "JSXExpressionContainer"))
      ) {
        return;
      }
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
      const fontSizePx = getStaticTailwindFontSize(classNameValue);
      if (
        fontSizePx === null ||
        fontSizePx <= 0 ||
        fontSizePx > TINY_UPPERCASE_TRACKED_LABEL_MAX_PX
      ) {
        return;
      }
      const effectiveCase = getEffectiveTailwindClassNameToken(tokens, (utility) =>
        CASE_TOKENS.has(utility),
      );
      if (effectiveCase !== "uppercase") return;
      if (!getEffectiveNonzeroTailwindTracking(tokens)) return;
      context.report({
        node: node.openingElement,
        message:
          "This tiny uppercase tracked label is difficult to scan and makes the interface feel mechanically styled. Use readable sentence-case text.",
      });
    },
  }),
});
