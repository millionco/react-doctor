/**
 * Severity threshold at which a scan blocks CI (exits non-zero). Controlled
 * by `blocking` / `--blocking` (default `"error"`):
 *
 * - `"error"` — block when an `"error"`-severity diagnostic reaches the
 *   `ciFailure` surface. The default.
 * - `"warning"` — block on any diagnostic (warnings included).
 * - `"none"` — never block; the scan is advisory (still reports + scores).
 */
export type BlockingLevel = "error" | "warning" | "none";

/**
 * How much of the project a scan looks at and reports on — the single knob the
 * CLI `--scope` flag, the GitHub Action `scope` input, and this config field
 * all share. Ordered widest to narrowest:
 *
 * - `"full"` — whole project, every issue (the default). Whole-project checks
 *   (dead-code, environment, supply-chain) run only at this scope.
 * - `"files"` — only the files changed vs the base, with ALL issues in them
 *   (no compare-to-main). What `--staged` and an uncommitted `--diff` do today.
 * - `"changed"` — only issues the change INTRODUCED vs the base (the baseline
 *   delta). What `--diff <base>` and the action's `scope: changed` do today.
 * - `"lines"` — only issues on the lines the change actually touched.
 */
export type ScopeValue = "full" | "files" | "changed" | "lines";

export interface ReactDoctorIgnoreOverride {
  /** Glob patterns the override applies to (e.g. `["src/legacy/**"]`). */
  files: string[];
  /**
   * Rule keys to suppress for the matched files. Omit (or leave empty) to
   * suppress every rule for those files.
   */
  rules?: string[];
}

interface ReactDoctorIgnoreConfig {
  /**
   * Fully-qualified rule keys (`"<plugin>/<rule>"`) whose diagnostics are
   * dropped AFTER linting. The rule still runs; its findings are filtered
   * out. To stop a rule from running at all, set it to `"off"` in the
   * top-level `rules` map instead. Prefer `react-doctor rules disable
   * <rule>` to edit this safely.
   */
  rules?: string[];
  /**
   * Glob patterns whose files are excluded from scanning entirely (matched
   * against paths relative to the scanned directory).
   */
  files?: string[];
  /** Per-path rule suppressions — narrower than the top-level `rules`/`files`. */
  overrides?: ReactDoctorIgnoreOverride[];
  /**
   * Behavioral tags whose rules are disabled BEFORE linting, skipping a
   * whole family at once (e.g. `["design", "test-noise", "migration-hint"]`).
   * Prefer `react-doctor rules ignore-tag <tag>` to edit this safely.
   */
  tags?: string[];
}

/**
 * Discrete output channels a diagnostic can flow through after a scan.
 * Each surface is filtered independently so a rule can be visible
 * locally but excluded from PR comments, the score, or the CI gate:
 *
 * - `cli` — local terminal output from `react-doctor` (`printDiagnostics`).
 * - `prComment` — diagnostics destined for a sticky pull-request
 *   summary comment. Selected by running the CLI with `--pr-comment`
 *   (sets `outputSurface: "prComment"`).
 * - `score` — diagnostics shipped to the React Doctor score API
 *   (or counted toward local score calculations).
 * - `ciFailure` — diagnostics that count toward the CI exit-code gate.
 *   react-doctor blocks (exits non-zero) when a diagnostic at or above the
 *   `blocking` threshold reaches this surface (default: `"error"`). A
 *   diagnostic excluded from this surface never fails the build,
 *   regardless of severity.
 *
 * Defaults: design rules (tag `"design"`) are excluded from `prComment`,
 * `score`, and `ciFailure` so style cleanup doesn't dilute meaningful
 * React findings. They remain in `cli` so locally-running developers
 * still see the suggestion when they touch the file.
 */
export type DiagnosticSurface = "cli" | "prComment" | "score" | "ciFailure";

/**
 * Severity value accepted by the top-level `rules` and `categories`
 * config fields. Exactly the same form ESLint and oxlint accept:
 * `"off"` skips registration entirely (the rule never runs and
 * never enters any surface); `"error"` / `"warn"` change the rule's
 * registered severity.
 *
 * For visibility-only adjustments (silence on PR comments but keep
 * on CLI / score), prefer `surfaces` instead — severity applies
 * before lint runs and is the most aggressive control.
 */
export type RuleSeverityOverride = "error" | "warn" | "off";

/**
 * Internal shape consumed by `resolveRuleSeverityOverride` and
 * `buildDiagnosticPipeline`. Assembled at runtime from the top-level
 * `rules` and `categories` fields on `ReactDoctorConfig`. Per-rule
 * wins over per-category when both match the same diagnostic.
 */
export interface RuleSeverityControls {
  rules?: Record<string, RuleSeverityOverride>;
  categories?: Record<string, RuleSeverityOverride>;
  /**
   * Severity overrides keyed by a named rule *bucket* — a curated family of
   * rules that share a gating story rather than a category. The only bucket
   * today is `"compiler-cleanup"` (the redundant-memoization rule that ships
   * as a warning once React Compiler is detected); setting it to `"error"`
   * re-enables strictness. A per-rule override still wins over a bucket.
   */
  buckets?: SeverityBuckets;
}

/**
 * Closed set of severity buckets. Spelled out (rather than
 * `Record<string, …>`) so an unknown/typo'd bucket key is a type error
 * instead of a silent no-op.
 */
export interface SeverityBuckets {
  "compiler-cleanup"?: RuleSeverityOverride;
}

export interface SurfaceControls {
  /**
   * Tag names whose diagnostics should be force-included on the surface,
   * even if a default or category-level exclusion would otherwise drop
   * them. Include wins over exclude when both apply to the same rule.
   */
  includeTags?: string[];
  /**
   * Tag names whose diagnostics should be excluded from the surface.
   * Use this to silence whole rule families (e.g. `["design"]`,
   * `["test-noise"]`) for a single channel without touching others.
   */
  excludeTags?: string[];
  /** Category names (e.g. `"Maintainability"`) to force-include. */
  includeCategories?: string[];
  /** Category names (e.g. `"Maintainability"`) to exclude. */
  excludeCategories?: string[];
  /**
   * Fully-qualified rule keys (`"<plugin>/<rule>"`, e.g.
   * `"react-doctor/design-no-redundant-size-axes"`) to force-include.
   */
  includeRules?: string[];
  /** Fully-qualified rule keys to exclude from this surface. */
  excludeRules?: string[];
}

/**
 * Configuration for the Socket.dev supply-chain score check (the
 * `SupplyChain` service). Runs by default; set `enabled: false` to opt out
 * (it performs one network request per direct dependency).
 *
 * Mirrors how Socket Firewall's free tier (`sfw`) works: each direct
 * dependency's PURL is looked up against Socket's keyless
 * `firewall-api.socket.dev/purl/<purl>` endpoint, which returns per-axis
 * scores (0–100 once normalized). A dependency whose worst security axis
 * (supply chain or vulnerability) scores below `minScore` produces a
 * diagnostic; at the default `severity: "error"` it fails the scan
 * (non-zero CI exit), the same way an error-severity lint finding does.
 */
export interface SupplyChainConfig {
  /**
   * Whether to run the Socket supply-chain score check. Default: `true`.
   * Set to `false` to opt out — the check performs one network request per
   * direct dependency. It is always skipped in `--diff` / `--staged` mode
   * and in editor scans regardless of this setting.
   */
  enabled?: boolean;
  /**
   * Minimum acceptable Socket score on a 0–100 scale. A direct dependency
   * whose worst Socket *security* axis — supply chain or vulnerability — is
   * below this is flagged; the quality / maintenance / license axes never
   * gate. Default: `50`. Values outside `0..100` are clamped.
   */
  minScore?: number;
  /**
   * Severity for a below-threshold dependency. `"error"` (default) fails
   * the scan at the standard `blocking: "error"` gate; `"warning"` keeps
   * the finding advisory.
   */
  severity?: "error" | "warning";
  /**
   * Whether to score `devDependencies` in addition to `dependencies`.
   * Default: `true`.
   */
  includeDevDependencies?: boolean;
}

export interface ReactDoctorConfig {
  $schema?: string;
  ignore?: ReactDoctorIgnoreConfig;
  lint?: boolean;
  /**
   * Socket.dev supply-chain score gate. Runs by default; set
   * `supplyChain: { enabled: false }` to opt out. See {@link SupplyChainConfig}.
   * Every direct dependency is scored against Socket's free PURL endpoint and
   * a low score fails the scan (at the default `severity: "error"`).
   */
  supplyChain?: SupplyChainConfig;
  /**
   * Whether to run dead-code analysis (via `deslop-js`) alongside lint.
   * Reports unused files, unused exports, unused dependencies, and
   * circular imports under the "Maintainability" category. Default: `true`.
   * Always skipped in `--diff` / `--staged` modes because reachability
   * is a whole-project property.
   */
  deadCode?: boolean;
  verbose?: boolean;
  /**
   * Whether to surface `"warning"`-severity diagnostics. Default: `true`
   * — every warning reaches every surface (CLI, PR comment, score, the
   * CI gate). Warnings only flip the exit code when `blocking` is set to
   * `"warning"`; at the default `"error"` threshold they stay advisory.
   *
   * Set to `false` to surface only `"error"`-severity findings. This is the
   * master toggle and runs after per-rule / per-category severity
   * overrides: a rule the user explicitly restamps to `"warn"` (via
   * `rules` / `categories`) still shows even when `warnings` is `false`.
   */
  warnings?: boolean;
  /**
   * Scan scope. Defaults to `"full"`. See `ScopeValue` for the four values.
   * The CLI `--scope` flag and the GitHub Action `scope` input set the same
   * thing; flags win over config.
   */
  scope?: ScopeValue;
  /**
   * Base git ref the `"files"` / `"changed"` / `"lines"` scopes compare
   * against. Auto-detected from the default branch / merge-base when unset.
   */
  base?: string;
  /**
   * @deprecated Use `scope` instead. Still honored as an alias when `scope`
   * is unset: `diff: "<base>"` / `diff: true` → `scope: "changed"`,
   * `diff: false` → `scope: "full"`. Using it emits a one-time deprecation
   * warning. Prefer `scope` (+ `base`).
   */
  diff?: boolean | string;
  /**
   * Severity threshold at which the scan blocks CI (exits non-zero).
   * Default: `"error"` — only `"error"`-severity diagnostics on the
   * `ciFailure` surface fail the build. Set to `"warning"` to also block
   * on warnings, or `"none"` to keep the scan advisory (it still reports
   * findings and a score, but always exits `0`).
   *
   * The GitHub Action exposes the same control as its `blocking`
   * input, and the CLI as `--blocking <level>`. Flags win over config.
   */
  blocking?: BlockingLevel;
  /**
   * @deprecated Renamed to `blocking` (same values + default). Still
   * honored as an alias when `blocking` is unset, but using it emits a
   * one-time deprecation warning. Prefer `blocking`.
   */
  failOn?: BlockingLevel;
  customRulesOnly?: boolean;
  share?: boolean;
  noScore?: boolean;
  /**
   * Redirect react-doctor at a different project directory than the one
   * it was invoked against. Resolved relative to the location of the
   * config file that declared this field (NOT relative to the CWD), so
   * the redirect is stable no matter where the CLI / `diagnose()` is
   * run from. Absolute paths are used as-is.
   *
   * Typical use: a monorepo root holds the only `doctor.config.*`
   * (so editor tooling and child commands all find it), but the React
   * app lives in `apps/web`. Setting `"rootDir": "apps/web"` makes
   * every invocation that loads this config scan that subproject
   * without anyone needing to `cd` first or pass an explicit path.
   *
   * Ignored if the resolved path does not exist or is not a directory
   * (a warning is emitted and react-doctor falls back to the originally
   * requested directory).
   */
  rootDir?: string;
  /**
   * Projects to scan and score separately — the config-file equivalent of
   * the CLI `--project` flag, for repos that always want per-module scoring
   * (e.g. a monorepo dashboard tracking each module's score daily) without
   * passing the flag on every run.
   *
   * Entries resolve exactly like `--project` values: workspace package
   * names (or directory basenames) first, then directory paths relative to
   * the scanned root. `"*"` selects every discovered workspace project.
   * Invalid entries fail the run with the same error as the flag.
   *
   * Precedence: an explicit `--project` flag overrides this list. Only the
   * config at the invocation root is consulted — `projects` inside a
   * module's own config is ignored (modules can't redirect the scan).
   */
  projects?: string[];
  textComponents?: string[];
  /**
   * Names of components that safely route string-only children through a
   * React Native `<Text>` internally (e.g. `heroui-native`'s `Button`,
   * which stringifies its children and renders them through a
   * `ButtonLabel` → `Text`). For listed components, `rn-no-raw-text`
   * is suppressed ONLY when the wrapper's children are entirely
   * stringifiable (no nested JSX elements). A wrapper with mixed
   * children — e.g. `<Button>Save<Icon /></Button>` — still reports,
   * because the wrapper can't safely route raw text alongside a
   * sibling JSX element.
   *
   * Use this instead of `textComponents` when the component is not
   * itself a text element but is known to wrap its string children
   * in one. `textComponents` is the broader escape hatch and
   * suppresses regardless of sibling content.
   */
  rawTextWrapperComponents?: string[];
  /**
   * Project-level allowlist of function names that the
   * `server-auth-actions` rule treats as an auth check at the top of
   * a server action. Names are accepted whether called as a bare
   * identifier (`myAuthGuard()`) or as the final property of a
   * member call (`ctx.myAuthGuard()`); unlike the built-in default
   * list, user-provided names are treated as distinctive and never
   * subject to receiver-object disambiguation.
   *
   * Common guard conventions are already recognized automatically
   * (`requireAdmin`, `ensureSignedIn`, `getCurrentUser`, `hasRole`, …),
   * so this is only needed for domain-specific guards whose names carry
   * no auth noun — e.g. a project-local `requireWorkspaceMember`.
   */
  serverAuthFunctionNames?: string[];
  /**
   * Whether to respect inline `// eslint-disable*`, `// oxlint-disable*`,
   * and `// react-doctor-disable*` comments in source files. Default: `true`.
   *
   * File-level ignores (`.gitignore`, `.eslintignore`, `.oxlintignore`,
   * `.prettierignore`, `.gitattributes` `linguist-vendored` /
   * `linguist-generated`) are ALWAYS honored regardless of this option
   * — they typically point at vendored or generated code that
   * genuinely shouldn't be linted at all.
   *
   * Set to `false` for "audit mode": every inline suppression is
   * neutralized so react-doctor reports every diagnostic regardless
   * of historical hide-comments.
   */
  respectInlineDisables?: boolean;
  /**
   * Whether to merge the user's existing JSON oxlint / eslint config
   * (`.oxlintrc.json` or `.eslintrc.json`) into the generated scan via
   * oxlint's `extends` field, so diagnostics from those rules count
   * toward the react-doctor score. Default: `true`.
   *
   * Detection runs at the scanned directory and walks up to the
   * nearest project boundary (`.git` directory or monorepo root).
   * The first match wins, with `.oxlintrc.json` preferred over
   * `.eslintrc.json`.
   *
   * Only JSON-format configs are supported because oxlint's `extends`
   * cannot evaluate JS/TS configs. Flat configs (`eslint.config.js`),
   * legacy JS configs (`.eslintrc.js`), and TypeScript oxlint configs
   * (`oxlint.config.ts`) are silently skipped.
   *
   * Category-level enables in the user's config (`"categories": { ... }`)
   * are NOT honored — react-doctor explicitly disables every oxlint
   * category to keep the scan scoped to its curated rule surface, and
   * local config wins over `extends`. Use rule-level severities to
   * fold rules into the score.
   *
   * Set to `false` to scan only react-doctor's curated rule set.
   */
  adoptExistingLintConfig?: boolean;
  /**
   * Per-surface include/exclude controls. Each `DiagnosticSurface` is
   * resolved independently against rule tags, category, and id so a
   * single rule can be visible locally yet hidden from PR comments,
   * neutralized from the score, and excluded from the CI gate — all
   * without touching the rule's severity or activation.
   *
   * Defaults (applied before user overrides):
   *
   * - `prComment` excludes tag `"design"`
   * - `score` excludes tag `"design"`
   * - `ciFailure` excludes tag `"design"`
   *
   * Pass any controls block (even an empty `{}`) to keep the default
   * exclusions; the user's include/exclude entries layer on top.
   * Include entries always win over exclude entries — handy for
   * promoting a single high-signal `design-*` rule back into the
   * score or PR-comment surface.
   */
  surfaces?: Partial<Record<DiagnosticSurface, SurfaceControls>>;
  /**
   * Per-rule severity map — the exact ESLint / oxlint top-level
   * `rules` field. Keys are fully-qualified rule keys
   * (`"<plugin>/<rule>"`, e.g. `"react-doctor/no-array-index-as-key"`),
   * values are `"error" | "warn" | "off"`.
   *
   * `"off"` skips registration in the generated lint config so the
   * rule never runs; `"error"` / `"warn"` re-stamp the registered
   * severity and the post-lint diagnostic, so downstream consumers
   * (the CI gate, the score, the printed list) all see the
   * user-chosen severity.
   *
   * For visibility-only changes (silence on PR comments but keep on
   * CLI / score), prefer `surfaces` instead. Most specific control
   * wins: `rules` > `categories` > `tags`.
   *
   * ```json
   * { "rules": { "react-doctor/no-array-index-as-key": "error" } }
   * ```
   */
  rules?: Record<string, RuleSeverityOverride>;
  /**
   * Per-category severity map. Mirrors oxlint's top-level
   * `categories` field, but keyed by React Doctor's five user-facing
   * buckets: `"Security"`, `"Bugs"`, `"Performance"`,
   * `"Accessibility"`, `"Maintainability"`.
   *
   * ```json
   * { "categories": { "Maintainability": "off", "Performance": "warn" } }
   * ```
   *
   * To silence a whole tag-defined rule family (e.g. `"design"`,
   * `"test-noise"`, `"migration-hint"`) that doesn't align with a
   * single category, use `ignore.tags` instead.
   */
  categories?: Record<string, RuleSeverityOverride>;
  /**
   * Per-bucket severity map. Buckets are curated rule families with a
   * shared gating story (not categories). Today the only bucket is
   * `"compiler-cleanup"`: the redundant-memoization rule
   * (`react-compiler-no-manual-memoization`) that ships as a warning once
   * React Compiler is detected. Set it to `"error"` to re-enable strictness.
   *
   * ```json
   * { "buckets": { "compiler-cleanup": "error" } }
   * ```
   *
   * A per-rule override in `rules` still wins over a bucket entry.
   */
  buckets?: SeverityBuckets;
  /**
   * User-defined oxlint plugins to load alongside the built-in
   * `react-doctor` plugin. Each entry is either:
   *
   * - A **relative path** to a JS / TS file (resolved relative to
   *   the directory of the config file that declared it — NOT the
   *   CWD), e.g. `"./lint/my-rules.js"`.
   * - An **npm package name**, e.g. `"react-doctor-plugin-team-conventions"`.
   *
   * The module must default-export an oxlint-shaped plugin:
   * `{ meta: { name: string }, rules: Record<string, HostRule> }`.
   * Use `defineRule` from `oxlint-plugin-react-doctor` for the
   * cleanest authoring shape — see CONTRIBUTING.md → "Writing a
   * custom plugin" for the full template.
   *
   * Rules from a user plugin are **opt-in by default**: a rule
   * doesn't run unless `rules: { "<plugin-name>/<rule>": "warn" | "error" }`
   * explicitly enables it. (Mirrors how `defaultEnabled: false`
   * rules behave in the built-in plugin.) Once enabled, the rule
   * flows through every react-doctor surface (CLI / PR comment /
   * score / CI gate) the same as a built-in rule.
   *
   * ```json
   * {
   *   "plugins": [
   *     "./lint/my-team-rules.js",
   *     "react-doctor-plugin-shopify-conventions"
   *   ],
   *   "rules": {
   *     "my-team-rules/no-bare-fetch": "error",
   *     "shopify-conventions/use-polaris-tokens": "warn"
   *   }
   * }
   * ```
   */
  plugins?: string[];
}
