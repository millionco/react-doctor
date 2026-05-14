import type { RuleContext } from "./rule-context.js";
import type { RuleExample } from "./rule-example.js";
import type { RuleVisitors } from "./rule-visitors.js";

export type RuleSeverity = "error" | "warn";

// `global` rules are enabled on every project; the other buckets only
// activate when the project actually uses that framework (detected by
// `detectProject`). The framework name doubles as the ESLint flat-config
// key — `recommended` for global, `next` for nextjs, and so on.
export type RuleFramework =
  | "global"
  | "nextjs"
  | "react-native"
  | "tanstack-start"
  | "tanstack-query";

export interface Rule {
  category?: string;
  framework?: RuleFramework;
  severity?: RuleSeverity;
  recommendation?: string;
  examples?: RuleExample[];
  create: (context: RuleContext) => RuleVisitors;
}
