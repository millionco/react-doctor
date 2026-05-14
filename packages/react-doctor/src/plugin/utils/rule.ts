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
  framework: RuleFramework;
  severity: RuleSeverity;
  // Activation predicates: list of project capability tokens (e.g.
  // `"react:19"`, `"nextjs"`, `"tailwind:3.4"`) that ALL must be satisfied
  // for the rule to be enabled. Omit for rules that always apply once
  // their framework gate (`framework` field above) is met.
  requires?: ReadonlyArray<string>;
  // Behavioral tags (e.g. `"test-noise"`, `"design"`) consumed by
  // `--ignore-tag` / `shouldEnableRule` to opt families of rules in
  // or out of a scan independently of the framework gate.
  tags?: ReadonlyArray<string>;
  recommendation?: string;
  examples?: RuleExample[];
  create: (context: RuleContext) => RuleVisitors;
}
