import { isInkVersionAtLeast } from "./resolve-ink-version.js";
import type { Rule } from "./rule.js";
import type { RuleVisitors } from "./rule-visitors.js";

const EMPTY_VISITORS: RuleVisitors = {};

export const wrapInkRule = (rule: Rule): Rule => {
  const innerCreate = rule.create.bind(rule);
  return {
    ...rule,
    create: (context) => {
      if (
        !rule.minimumInkVersion ||
        !isInkVersionAtLeast(context.filename, rule.minimumInkVersion)
      ) {
        return EMPTY_VISITORS;
      }
      return innerCreate(context);
    },
  };
};
