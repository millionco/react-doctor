import { isReactRouterFileActive } from "./is-react-router-file.js";
import type { Rule } from "./rule.js";
import type { RuleVisitors } from "./rule-visitors.js";

const EMPTY_VISITORS: RuleVisitors = {};

export const wrapReactRouterRule = (rule: Rule): Rule => {
  const innerCreate = rule.create.bind(rule);
  return {
    ...rule,
    create: (context) => {
      if (!isReactRouterFileActive(context)) return EMPTY_VISITORS;
      return innerCreate(context);
    },
  };
};
