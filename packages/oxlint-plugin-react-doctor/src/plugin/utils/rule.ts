import type { Capability, CapabilityQuery } from "./capability.js";
import type { FileScan } from "./file-scan.js";
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
  | "tanstack-query"
  | "preact";

export interface Rule {
  // Public-facing rule identifier — what users put in their oxlint config
  // (`react-doctor/<id>`) and what shows up in diagnostic output. Owned by
  // the rule itself (not its filename or export-variable name) because
  // some rule-ids carry historical prefixes the file path doesn't —
  // e.g. `react-ui/no-em-dash-in-jsx-text.ts` registers as `design-no-em-dash-in-jsx-text`.
  id: string;
  // Very short human headline for the rule (a few words, no trailing
  // period) naming the problem it catches, e.g. "Array index used as a
  // key". Surfaced in docs and summary UIs alongside the longer
  // per-diagnostic `message`.
  title?: string;
  severity: RuleSeverity;
  // Fine-grained category intent. Both this override and the bucket-
  // directory default are collapsed at codegen (see `CATEGORY_BUCKET` in
  // `generate-rule-registry.mjs`) into one of the five user-facing
  // buckets the scan output actually shows — Security, Bugs, Performance,
  // Accessibility, Maintainability — so e.g. `"Architecture"` ships as
  // `"Maintainability"` and `"Correctness"` as `"Bugs"`. Set this only to
  // steer the bucket (e.g. a `state-and-effects/` rule that's really a
  // perf concern overrides to "Performance"). Codegen-only field; rules
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
  requires?: ReadonlyArray<Capability>;
  // Inverse of `requires`: list of capability tokens whose presence
  // DISABLES the rule. Used for rules that become irrelevant when a
  // project ships with React Compiler (auto-memoization makes the four
  // `jsx-no-new-*-as-prop` perf rules unnecessary, for example). If
  // ANY listed capability is present the rule is skipped.
  disabledWhen?: ReadonlyArray<Capability>;
  // Behavioral tags (e.g. `"test-noise"`, `"design"`) consumed by
  // `--ignore-tag` / `shouldEnableRule` to opt families of rules in
  // or out of a scan independently of the framework gate.
  tags?: ReadonlyArray<string>;
  // When `true`, a finding's identity is the flagged element itself (a
  // missing attribute, a wrong element) rather than the flagged line's
  // text, so reformatting the line doesn't change the finding. The CI
  // baseline delta (`computeDiagnosticDelta` in @react-doctor/core)
  // then matches these by `(file, rule)` occurrence count instead of a
  // line-text hash. Rules in the `Accessibility` category get this
  // behavior implicitly; set the flag only on element-level rules
  // outside that category. Leave unset for expression-level rules, where
  // the flagged expression IS the finding and a text change means a new
  // one.
  matchByOccurrence?: boolean;
  // When `false`, the rule is registered in the plugin (importable,
  // configurable, testable) but NOT enabled by default — users must
  // opt in via `severityControls.rules["react-doctor/<id>"]`. Used for
  // ports of upstream rules whose defaults produce massive noise on
  // modern React codebases (`react-in-jsx-scope` post-React-17,
  // `forbid-component-props` flagging `className`, etc.).
  defaultEnabled?: boolean;
  // Retired rules stay registered only so legacy configs and docs tooling
  // can resolve the id. They intentionally never report diagnostics.
  lifecycle?: "retired";
  // Project-level file scan. Rules with `scan` are registered for
  // metadata/tags/severity like any rule, but are EXCLUDED from the
  // generated oxlint config and executed by @react-doctor/core's
  // check-security-scan environment check over a whole-tree walk.
  scan?: FileScan;
  // When `true`, the rule's finding only applies to files actually committed
  // to the repository (its message asserts the file is "checked in"). The scan
  // host drops findings for paths git ignores, so a local-only gitignored file
  // (e.g. a `.env` in `.gitignore`) is not flagged. Lets a scan rule declare
  // this without coupling the host to specific rule ids.
  committedFilesOnly?: boolean;
  recommendation?: string;
  // Capability-conditioned override of `recommendation`, evaluated by
  // @react-doctor/core's diagnostic pipeline where the scanned project's
  // capability set is known. Return `undefined` to fall back to the static
  // `recommendation` (which stays the project-agnostic prose that docs,
  // the rule catalog, and LSP hover render).
  recommendationFor?: (hasCapability: CapabilityQuery) => string | undefined;
  create: (context: RuleContext) => RuleVisitors;
}
