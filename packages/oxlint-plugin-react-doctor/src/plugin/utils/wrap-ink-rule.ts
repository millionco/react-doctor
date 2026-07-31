import { EMPTY_RULE_VISITORS } from "./empty-rule-visitors.js";
import { isInkVersionAtLeast } from "./resolve-ink-version.js";
import type { Rule } from "./rule.js";

export const wrapInkRule = (rule: Rule): Rule => {
  const innerCreate = rule.create.bind(rule);
  return {
    ...rule,
    create: (context) => {
      if (
        !rule.minimumInkVersion ||
        !isInkVersionAtLeast(context.filename, rule.minimumInkVersion)
      ) {
        return EMPTY_RULE_VISITORS;
      }
      return innerCreate(context);
    },
  };
};
