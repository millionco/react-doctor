import { isNextFileActive } from "./is-next-file.js";
import type { Rule } from "./rule.js";
import type { RuleVisitors } from "./rule-visitors.js";

const EMPTY_VISITORS: RuleVisitors = {};

// Wraps a rule whose `create` should only run on files that belong to a
// package depending on Next.js. Mirrors `wrapReactNativeRule`: the
// project-level `requires: ["nextjs"]` capability enables the Next rules
// for the WHOLE project, but in a monorepo only some workspaces are Next
// apps — files in a web-only sibling package must not get `next/image` /
// `next/link` advice. When the nearest `package.json` says the file's own
// package never depends on Next, we return empty visitors so oxlint never
// invokes the rule body. Spreading the rule preserves `framework`,
// `category`, `severity`, `requires`, `tags`, and `recommendation`.
export const wrapNextjsRule = (rule: Rule): Rule => {
  const innerCreate = rule.create.bind(rule);
  return {
    ...rule,
    create: (context) => {
      if (!isNextFileActive(context)) return EMPTY_VISITORS;
      return innerCreate(context);
    },
  };
};
