import { EMPTY_RULE_VISITORS } from "./empty-rule-visitors.js";
import { isReactNativeFileActive } from "./is-react-native-file.js";
import type { Rule } from "./rule.js";

export const wrapReactNativeRule = (rule: Rule): Rule => {
  const innerCreate = rule.create.bind(rule);
  return {
    ...rule,
    create: (context) => {
      if (!isReactNativeFileActive(context)) return EMPTY_RULE_VISITORS;
      return innerCreate(context);
    },
  };
};
