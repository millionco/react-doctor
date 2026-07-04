import type { FileScan } from "./file-scan.js";
import type { RuleContext } from "./rule-context.js";
import type { RuleVisitors } from "./rule-visitors.js";

export type RuleSeverity = "error" | "warn";

// What a finding of this rule represents for the user's app. `behavior`
// is the load-bearing value — external gates (react-bench's footgun
// verifier) key on it — so classify a rule `behavior` only when
// violating it produces wrong runtime behavior: broken logic, wrong
// data, stale UI, crashes. Framework-convention rules whose failure
// mode is degradation rather than breakage are `style`.
export type RuleImpact = "behavior" | "style" | "perf" | "a11y" | "security";

// Detector precision tier. `high` = AST-precise detection that is safe
// to gate/block on; `heuristic` = pattern-matching with known
// false-positive classes, better treated as advisory.
export type RuleConfidence = "high" | "heuristic";

// Scope of the remediation a finding demands. `mechanical` = a
// deterministic rewrite a codemod could apply; `local` = confined to
// the flagged site but needs small judgment; `structural` = a
// cross-cutting refactor beyond the flagged site.
export type RuleFix = "mechanical" | "local" | "structural";

// Closed vocabulary for a rule's `tags`. The bare tags are behavioral
// controls (opt families in/out of a scan); the `impact:`/`confidence:`/
// `fix:` forms are PROJECTED by codegen from the same-named required
// fields — never hand-write them in a rule's `tags` array (the registry
// generator rejects it). Typing `tags` to this union turns a tag typo
// into a compile error.
export type RuleTag =
  | "design"
  | "migration-hint"
  | "react-jsx-only"
  | "react-native"
  | "security-scan"
  | "server-action"
  | "test-noise"
  | `impact:${RuleImpact}`
  | `confidence:${RuleConfidence}`
  | `fix:${RuleFix}`;

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
  requires?: ReadonlyArray<string>;
  // Inverse of `requires`: list of capability tokens whose presence
  // DISABLES the rule. Used for rules that become irrelevant when a
  // project ships with React Compiler (auto-memoization makes the four
  // `jsx-no-new-*-as-prop` perf rules unnecessary, for example). If
  // ANY listed capability is present the rule is skipped.
  disabledBy?: ReadonlyArray<string>;
  // Classification axes, projected by codegen into the registry entry's
  // `tags` as `impact:<v>` / `confidence:<v>` / `fix:<v>` — never
  // hand-write those tag forms in `tags`. Required: the registry
  // generator refuses to emit a rule that omits any of them.
  impact: RuleImpact;
  confidence: RuleConfidence;
  fix: RuleFix;
  // Behavioral tags (e.g. `"test-noise"`, `"design"`) consumed by
  // `--ignore-tag` / `shouldEnableRule` to opt families of rules in
  // or out of a scan independently of the framework gate. `design` is
  // a narrower surface-semantics tag than `impact:style` (default-
  // excluded from prComment/score/ciFailure); every `design` rule is
  // also `impact:style`.
  tags?: ReadonlyArray<RuleTag>;
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
  create: (context: RuleContext) => RuleVisitors;
}
