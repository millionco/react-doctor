import { EM_DASH_CHARACTER } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isInsideExcludedAncestor } from "./utils/is-inside-excluded-ancestor.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noEmDashInJsxText = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    "Em dash (—) in JSX text reads as model output — replace with comma, colon, semicolon, or parentheses",
  examples: [
    {
      before: "<p>It was the best of times — and the worst of times.</p>",
      after: "<p>It was the best of times, and the worst of times.</p>",
    },
  ],
  create: (context: RuleContext) => ({
    JSXText(jsxTextNode: EsTreeNodeOfType<"JSXText">) {
      const textValue = typeof jsxTextNode.value === "string" ? jsxTextNode.value : "";
      if (!textValue.includes(EM_DASH_CHARACTER)) return;
      if (isInsideExcludedAncestor(jsxTextNode)) return;
      context.report({
        node: jsxTextNode,
        message:
          "Em dash (—) in JSX text reads as model output — replace with comma, colon, semicolon, or parentheses",
      });
    },
  }),
});
