import { isReactNativeFileActive } from "./is-react-native-file.js";
import type { Rule } from "./rule.js";
import type { RuleVisitors } from "./rule-visitors.js";

const EMPTY_VISITORS: RuleVisitors = {};

// Wraps a rule whose `create` should only run on files that belong to a
// React Native or Expo package.
//
// Rather than have every `rn-*` rule re-implement the
// `package.json`-walking + `.web.tsx` checks at the top of its `create`,
// we apply a single shared gate at registry load time. When the file
// owning `context.getFilename()` does not match a React Native package,
// we return empty visitors so oxlint never invokes the rule body — no
// allocations, no AST walks, no diagnostics. The wrapper deliberately
// preserves the underlying rule's identity for non-RN-aware callers
// (`Object.assign({}, rule)`) so `framework`, `category`, `severity`,
// `requires`, `tags`, and `recommendation` continue to flow through.
//
// Used by the rule registry to wrap every `framework: "react-native"`
// rule. Other framework rules don't need this — they already key off
// `requires: ["nextjs" | "tanstack-start" | …]` and React Native is
// the only one with mixed-monorepo file-level ambiguity.
export const wrapReactNativeRule = (rule: Rule): Rule => {
  const innerCreate = rule.create.bind(rule);
  return {
    ...rule,
    create: (context) => {
      if (!isReactNativeFileActive(context)) return EMPTY_VISITORS;
      return innerCreate(context);
    },
  };
};
