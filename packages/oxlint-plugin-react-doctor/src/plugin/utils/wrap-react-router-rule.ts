import { EMPTY_RULE_VISITORS } from "./empty-rule-visitors.js";
import { isReactRouterFileActive } from "./is-react-router-file.js";
import type { Rule } from "./rule.js";

export const wrapReactRouterRule = (rule: Rule): Rule => {
  const innerCreate = rule.create.bind(rule);
  const requiresFramework = rule.requires?.includes("react-router-framework") === true;
  return {
    ...rule,
    create: (context) => {
      if (!isReactRouterFileActive(context, { requiresFramework })) return EMPTY_RULE_VISITORS;
      return innerCreate(context);
    },
  };
};
