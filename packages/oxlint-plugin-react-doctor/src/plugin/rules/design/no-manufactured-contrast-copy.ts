import { MANUFACTURED_COPY_PATTERN_MIN_COUNT } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

const NOT_THEN_ASSERTION_PATTERN =
  /\bnot\s+(?:just\s+)?[^.!?]{3,60}[.!?]\s+(?:it(?:'s| is)|we|you|a|an|the)\b/gi;
const NO_JUST_PATTERN = /\bno\s+[^.!?]{2,50}[.!?]\s+just\s+[^.!?]{2,60}(?:[.!?]|$)/gi;

const countMatches = (text: string, pattern: RegExp): number => [...text.matchAll(pattern)].length;

export const noManufacturedContrastCopy = defineRule({
  id: "no-manufactured-contrast-copy",
  title: "Page repeatedly uses manufactured contrast copy",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "State the value directly instead of repeatedly contrasting it with a vague alternative.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const pageText = getStaticJsxText(node).replace(/\s+/g, " ").trim();
      const patternCount =
        countMatches(pageText, NOT_THEN_ASSERTION_PATTERN) +
        countMatches(pageText, NO_JUST_PATTERN);
      if (patternCount < MANUFACTURED_COPY_PATTERN_MIN_COUNT) return;
      context.report({
        node: node.openingElement,
        message: `This page uses contrast-first sentence patterns ${patternCount} times. Rewrite the claims as direct, concrete statements.`,
      });
    },
  }),
});
