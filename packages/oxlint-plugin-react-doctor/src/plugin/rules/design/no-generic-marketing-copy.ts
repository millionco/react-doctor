import { GENERIC_MARKETING_PHRASES } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import { getStaticJsxText } from "../../utils/get-static-jsx-text.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isTopLevelPageCopyRoot } from "./utils/is-top-level-page-copy-root.js";

export const noGenericMarketingCopy = defineRule({
  id: "no-generic-marketing-copy",
  title: "Page uses generic marketing language",
  severity: "warn",
  defaultEnabled: false,
  tags: ["design", "test-noise"],
  recommendation:
    "Replace broad promotional phrases with concrete capabilities, outcomes, or evidence.",
  create: (context: RuleContext) => ({
    JSXElement(node: EsTreeNodeOfType<"JSXElement">) {
      if (!isTopLevelPageCopyRoot(node)) return;
      const pageText = getStaticJsxText(node).replace(/\s+/g, " ").toLowerCase();
      const matchedPhrase = [...GENERIC_MARKETING_PHRASES].find((phrase) =>
        pageText.includes(phrase),
      );
      if (!matchedPhrase) return;
      context.report({
        node: node.openingElement,
        message: `The phrase “${matchedPhrase}” makes a broad promise without saying what the product actually does. Use specific copy.`,
      });
    },
  }),
});
