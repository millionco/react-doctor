import { defineRule } from "./define-rule.js";
import { EMPTY_RULE_VISITORS } from "./empty-rule-visitors.js";
import type { Rule } from "./rule.js";

export const defineRetiredRule = (
  rule: Omit<Rule, "create" | "defaultEnabled" | "lifecycle">,
): Rule =>
  defineRule({
    ...rule,
    defaultEnabled: false,
    lifecycle: "retired",
    create: () => EMPTY_RULE_VISITORS,
  });
