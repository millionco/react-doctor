import { isReactRouterFileActive } from "./is-react-router-file.js";
import type { Rule } from "./rule.js";
import type { RuleVisitors } from "./rule-visitors.js";

const EMPTY_VISITORS: RuleVisitors = {};

export const wrapReactRouterRule = (rule: Rule): Rule => {
  const innerCreate = rule.create.bind(rule);
  const requiresFramework = rule.requires?.includes("react-router-framework") === true;
  return {
    ...rule,
    create: (context) => {
      if (!isReactRouterFileActive(context, { requiresFramework })) return EMPTY_VISITORS;
      return innerCreate(context);
    },
  };
};
