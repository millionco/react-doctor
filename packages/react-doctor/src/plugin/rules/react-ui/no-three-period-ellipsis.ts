import { TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN } from "../../constants.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isInsideExcludedAncestor } from "./utils/is-inside-excluded-ancestor.js";

export const noThreePeriodEllipsis = defineRule<Rule>({
  framework: "global",
  severity: "warn",
  category: "Architecture",
  recommendation:
    'Use the typographic ellipsis "…" (or `&hellip;`) instead of three periods — pairs with action-with-followup labels ("Rename…", "Loading…")',
  create: (context: RuleContext) => ({
    JSXText(jsxTextNode: EsTreeNode) {
      const textValue = typeof jsxTextNode.value === "string" ? jsxTextNode.value : "";
      if (!TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.test(textValue)) return;
      if (isInsideExcludedAncestor(jsxTextNode)) return;
      context.report({
        node: jsxTextNode,
        message:
          'Three-period ellipsis ("...") in JSX text — use the actual ellipsis character "…" (or `&hellip;`)',
      });
    },
  }),
});
