import type { RuleContext } from "./rule-context.js";
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
  // Public-facing rule identifier — what users put in their oxlint config
  // (`react-doctor/<id>`) and what shows up in diagnostic output. Owned by
  // the rule itself (not its filename or export-variable name) because
  // some rule-ids carry historical prefixes the file path doesn't —
  // e.g. `react-ui/no-bold-heading.ts` registers as `design-no-bold-heading`.
  id: string;
  severity: RuleSeverity;
  // Category override — when present, takes precedence over the bucket
  // default the codegen emits (most rules let the bucket choose, e.g. a
  // rule under `tanstack-start/` defaults to "TanStack Start"; a few
  // override to "Security" or "Performance"). Codegen-only field; rules
  // never need to set `framework` (always derived from bucket).
  category?: string;
  // Synthesized by codegen from the rule's bucket directory — set on the
  // entries in `rule-registry.ts`, not on the individual `defineRule({...})`
  // calls. Reading `rule.framework` at runtime works because the registry
  // is what consumers iterate.
  framework?: RuleFramework;
  // Activation predicates: list of project capability tokens (e.g.
  // `"react:19"`, `"nextjs"`, `"tailwind:3.4"`) that ALL must be satisfied
  // for the rule to be enabled. Omit for rules that always apply once
  // their framework gate is met.
  requires?: ReadonlyArray<string>;
  // Behavioral tags (e.g. `"test-noise"`, `"design"`) consumed by
  // `--ignore-tag` / `shouldEnableRule` to opt families of rules in
  // or out of a scan independently of the framework gate.
  tags?: ReadonlyArray<string>;
  recommendation?: string;
  create: (context: RuleContext) => RuleVisitors;
}
