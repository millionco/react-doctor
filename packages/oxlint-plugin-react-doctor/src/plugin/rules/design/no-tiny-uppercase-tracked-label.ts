import {
  ROOT_FONT_SIZE_PX,
  SHORT_DECORATIVE_LABEL_MAX_CHARACTERS,
  TAILWIND_TEXT_SIZE_PX,
  TINY_UPPERCASE_TRACKED_LABEL_MAX_PX,
} from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import { getUnvariantClassNameTokens } from "../../utils/get-unvariant-class-name-tokens.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { getStringFromClassNameAttr } from "./utils/get-string-from-class-name-attr.js";
import { getLastMatchingToken } from "./utils/get-last-matching-token.js";
import { isTechnicalLabelText } from "./utils/is-technical-label-text.js";

const PREFORMATTED_ELEMENT_NAMES = new Set(["code", "kbd", "pre", "samp", "var"]);
const CASE_TOKENS = new Set(["capitalize", "lowercase", "normal-case", "uppercase"]);
const ARBITRARY_FONT_SIZE_PATTERN = /^text-\[([\d.]+)(px|rem)\](?:\/.+)?$/;
const ZERO_TRACKING_PATTERN = /^tracking-\[(?:0|0\.0+)(?:em|px)\]$/;

const getEffectiveFontSizePx = (tokens: string[]): number | null => {
  let fontSizePx: number | null = null;
  for (const token of tokens) {
    const standardSizePx = TAILWIND_TEXT_SIZE_PX.get(token);
    if (standardSizePx !== undefined) {
      fontSizePx = standardSizePx;
      continue;
    }
    const arbitrarySizeMatch = token.match(ARBITRARY_FONT_SIZE_PATTERN);
    if (!arbitrarySizeMatch) continue;
    const value = Number.parseFloat(arbitrarySizeMatch[1]);
    fontSizePx = arbitrarySizeMatch[2] === "rem" ? value * ROOT_FONT_SIZE_PX : value;
  }
  return fontSizePx;
};

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
      const tokens = getUnvariantClassNameTokens(classNameValue);
      const fontSizePx = getEffectiveFontSizePx(tokens);
      if (
        fontSizePx === null ||
        fontSizePx <= 0 ||
        fontSizePx > TINY_UPPERCASE_TRACKED_LABEL_MAX_PX
      ) {
        return;
      }
      const effectiveCase = getLastMatchingToken(tokens, (token) => CASE_TOKENS.has(token));
      if (effectiveCase !== "uppercase") return;
      const effectiveTracking = getLastMatchingToken(tokens, (token) =>
        token.startsWith("tracking-"),
      );
      if (
        !effectiveTracking ||
        effectiveTracking === "tracking-normal" ||
        ZERO_TRACKING_PATTERN.test(effectiveTracking)
      ) {
        return;
      }
      context.report({
        node: node.openingElement,
        message:
          "This tiny uppercase tracked label is difficult to scan and makes the interface feel mechanically styled. Use readable sentence-case text.",
      });
    },
  }),
});
