export type FailOnLevel = "error" | "warning" | "none";

export interface ReactDoctorIgnoreOverride {
  files: string[];
  rules?: string[];
}

interface ReactDoctorIgnoreConfig {
  rules?: string[];
  files?: string[];
  overrides?: ReactDoctorIgnoreOverride[];
  tags?: string[];
}

/**
 * Discrete output channels a diagnostic can flow through after a scan.
 * Each surface is filtered independently so a rule can be visible
 * locally but excluded from PR comments, the score, or the CI gate:
 *
 * - `cli` — local terminal output from `react-doctor` (`printDiagnostics`).
 * - `prComment` — output captured by the GitHub Action for the sticky
 *   PR comment. Enabled when the CLI is run with `--pr-comment` (the
 *   action sets this automatically when `github-token` is provided).
 * - `score` — diagnostics shipped to the React Doctor score API
 *   (or counted toward local score calculations).
 * - `ciFailure` — diagnostics that count toward the `--fail-on` exit
 *   code gate. A diagnostic excluded from this surface never fails the
 *   build, regardless of severity.
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
  /** Category names (e.g. `"Architecture"`) to force-include. */
  includeCategories?: string[];
  /** Category names (e.g. `"Architecture"`) to exclude. */
  excludeCategories?: string[];
  /**
   * Fully-qualified rule keys (`"<plugin>/<rule>"`, e.g.
   * `"react-doctor/design-no-redundant-size-axes"`) to force-include.
   */
  includeRules?: string[];
  /** Fully-qualified rule keys to exclude from this surface. */
  excludeRules?: string[];
}

export interface ReactDoctorConfig {
  $schema?: string;
  ignore?: ReactDoctorIgnoreConfig;
  lint?: boolean;
  /**
   * Whether to run dead-code analysis (via `deslop-js`) alongside lint.
   * Reports unused files, unused exports, unused dependencies, and
   * circular imports under the "Dead Code" category. Default: `true`.
   * Always skipped in `--diff` / `--staged` modes because reachability
   * is a whole-project property.
   */
  deadCode?: boolean;
  verbose?: boolean;
  diff?: boolean | string;
  failOn?: FailOnLevel;
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
   * Typical use: a monorepo root holds the only `react-doctor.config.json`
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
   * Use this to teach react-doctor about custom auth guards in
   * codebases that wrap their auth library — e.g. a project-local
   * `requireWorkspaceMember` or `ensureSignedIn`.
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
   * neutralized from the score, and excluded from `--fail-on` — all
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
   * (`--fail-on`, the score, the printed list) all see the
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
   * `categories` field, but keyed by React Doctor's display
   * categories (`"Server"`, `"React Native"`, `"Architecture"`,
   * `"Bundle Size"`, `"State & Effects"`, `"Security"`,
   * `"Accessibility"`, `"Performance"`, `"Correctness"`,
   * `"Next.js"`, `"Preact"`, `"TanStack Query"`,
   * `"TanStack Start"`, …).
   *
   * ```json
   * { "categories": { "React Native": "warn", "Server": "off" } }
   * ```
   *
   * To silence a whole tag-defined rule family (e.g. `"design"`,
   * `"test-noise"`, `"migration-hint"`) that doesn't align with a
   * single category, use `ignore.tags` instead.
   */
  categories?: Record<string, RuleSeverityOverride>;
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
