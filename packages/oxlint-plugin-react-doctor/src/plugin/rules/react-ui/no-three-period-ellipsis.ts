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
  // Default off: subjective design / house-style preference, not a
  // correctness, performance, or accessibility issue. Opt in to enforce it.
  defaultEnabled: false,
  category: "Architecture",
  recommendation:
    'Use the real ellipsis character ("…") so UI labels look polished and consistent instead of like three separate periods.',
  create: (context: RuleContext) => ({
    JSXText(jsxTextNode: EsTreeNodeOfType<"JSXText">) {
      const textValue = typeof jsxTextNode.value === "string" ? jsxTextNode.value : "";
      if (!TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN.test(textValue)) return;
      if (isInsideExcludedTypographyAncestor(jsxTextNode)) return;
      context.report({
        node: jsxTextNode,
        message: 'Use the real ellipsis character ("…") instead of three period characters.',
      });
    },
  }),
});
