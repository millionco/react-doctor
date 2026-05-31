import { TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN } from "../../constants/design.js";
import { defineRule } from "../../utils/define-rule.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isInsideExcludedTypographyAncestor } from "./utils/is-inside-excluded-typography-ancestor.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

export const noThreePeriodEllipsis = defineRule<Rule>({
  id: "design-no-three-period-ellipsis",
  title: "Three dots instead of ellipsis",
  tags: ["design", "test-noise"],
  severity: "warn",
  category: "Architecture",
  recommendation:
    'Use the real ellipsis "…" (or `&hellip;`) instead of three dots. Good for labels like "Rename…" and "Loading…".',
  create: (context: RuleContext) => ({
    JSXText(jsxTextNode: EsTreeNodeOfType<"JSXText">) {
      const textValue = typeof jsxTextNode.value === "string" ? jsxTextNode.value : "";
      if (!TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.test(textValue)) return;
      if (isInsideExcludedTypographyAncestor(jsxTextNode)) return;
      context.report({
        node: jsxTextNode,
        message: 'Three dots ("...") look unpolished to your users.',
      });
    },
  }),
});
