# @react-doctor/core

## 0.5.0

### Minor Changes

- [#756](https://github.com/millionco/react-doctor/pull/756) [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede) Thanks [@NisargIO](https://github.com/NisargIO)! - React Doctor now runs on repositories that don't depend on React. Previously a scan hard-failed with `No React project found` / `No React dependency`, even though many checks (security, bundle size, JS performance, architecture, and the Zod rules) are framework-agnostic and apply to any TypeScript / JavaScript codebase.

  A project is now analyzable when it has source files, with or without React. A bare directory of TypeScript files — including a monorepo's `packages/` subfolder that has no `package.json` of its own — is scanned by inheriting dependency/framework detection from the enclosing workspace root.

  React-flavoured rules stay off without React. A new `react` capability (set only when React or Preact is present) gates every React-runtime rule family (hooks, JSX, accessibility, render performance, React state) plus any rule tagged `react-jsx-only`, so hook/component-name heuristics like `rules-of-hooks`, `no-legacy-class-lifecycles`, and `no-nested-component-definition` can't false-fire on ordinary TypeScript. Once React (or Preact) is detected, every rule behaves exactly as before.

### Patch Changes

- [#741](https://github.com/millionco/react-doctor/pull/741) [`963eaf5`](https://github.com/millionco/react-doctor/commit/963eaf53db7de069baf2c7d18075443c3d934f9b) Thanks [@NisargIO](https://github.com/NisargIO)! - Add a `no-vulnerable-react-server-components` security check that flags projects running React Server Components on a version with a known advisory — primarily the critical unauthenticated RCE (CVE-2025-55182, CVSS 10.0), and the later high-severity DoS (CVE-2026-23870).

  It resolves the concrete installed version of React's RSC runtime and compares it against the patched releases per minor line (19.0 → 19.0.6, 19.1 → 19.1.7, 19.2 → 19.2.6). Frameworks and bundlers that expose `react-server-dom-*` directly (Vite, Parcel, React Router, Waku, RedwoodSDK) are checked by those package versions; Next.js — which vendors its own RSC runtime — is checked by its `next` version and the easiest corrective fix points at a Next.js upgrade (15.5.18 / 16.2.6) rather than a React bump. Pure client-side React apps with no RSC packages and no Next.js are unaffected and stay quiet, and the check never flags off an ambiguous declared range whose lockfile may resolve to a patched version.

- Updated dependencies [[`b4b79ad`](https://github.com/millionco/react-doctor/commit/b4b79addce225c47048127e04be2670c13bca332), [`af98f83`](https://github.com/millionco/react-doctor/commit/af98f83614526cca30f3a31ec2507a5df5da2bed), [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede)]:
  - oxlint-plugin-react-doctor@0.5.0

## 0.4.2

### Patch Changes

- [#721](https://github.com/millionco/react-doctor/pull/721) [`d17dc87`](https://github.com/millionco/react-doctor/commit/d17dc87865e059f21534990d0925115db439dc3e) Thanks [@aidenybai](https://github.com/aidenybai)! - Add a `defineConfig` helper for authoring a typed `doctor.config.{ts,js,mjs,cjs}` and read `react-doctor.config.json` as a deprecated fallback.

  `defineConfig` is exported from `react-doctor/api` (and `@react-doctor/api` / `@react-doctor/core`) as an identity helper that gives editor autocomplete and type-checking without an explicit `satisfies ReactDoctorConfig` annotation:

  ```ts
  // doctor.config.ts
  import { defineConfig } from "react-doctor/api";

  export default defineConfig({
    lint: true,
    rules: { "react-doctor/no-array-index-as-key": "off" },
  });
  ```

  The pre-migration `react-doctor.config.json` filename is now read as the lowest-priority fallback (after `doctor.config.*` and `package.json#reactDoctor`) instead of being ignored, so an un-migrated config keeps applying. It still emits a deprecation warning nudging a rename, and interactive runs continue to auto-migrate it to `doctor.config.ts`. A present-but-broken legacy file stops config resolution (it won't silently inherit an ancestor repo's config), and `react-doctor rules <...>` migrates a legacy file to `doctor.config.json` on write rather than editing it in place.

  Note: a `react-doctor.config.json` that was previously ignored in non-interactive runs (CI, coding agents, `--json`/`--score`/`--staged`) is now honored again, which can change which rules fire, the score, and PR gating for projects that still have one. Rename it to `doctor.config.json` (or delete it) to avoid surprises.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.2

## 0.3.1

### Patch Changes

- [#715](https://github.com/millionco/react-doctor/pull/715) [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Disable `server-fetch-without-revalidate` on Next.js 15+ projects. Next.js 15 changed the default fetch behavior from cached-forever to `no-store`, making the rule's warning obsolete. Adds Next.js version detection (workspace- and `catalog:`-aware, mirroring Expo/FlashList resolution) and the `nextjs:15` capability gate.

- Updated dependencies [[`dc35070`](https://github.com/millionco/react-doctor/commit/dc35070a5066f9864a7565b952dec2f81bff1223), [`b1a22ef`](https://github.com/millionco/react-doctor/commit/b1a22efdf7b18f2cc8b7af6c0b12173ed3c76d34), [`73dcb20`](https://github.com/millionco/react-doctor/commit/73dcb2040dc6aa207beea074f846fd675c30bd2b), [`64667da`](https://github.com/millionco/react-doctor/commit/64667dae16b812ad9b4304bd7906d5ddbb50921a), [`ee9ab33`](https://github.com/millionco/react-doctor/commit/ee9ab336d3b2918d319bc048b5b164f58611df83), [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b), [`831cf3f`](https://github.com/millionco/react-doctor/commit/831cf3fbfd703f5048de5c2c3258e47988a2cce0)]:
  - oxlint-plugin-react-doctor@0.4.1

## 0.3.0

### Minor Changes

- [#663](https://github.com/millionco/react-doctor/pull/663) [`9a8ad6e`](https://github.com/millionco/react-doctor/commit/9a8ad6e40d9ed1fbe7ddb1f1c57bfd5c791a4b9e) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Rework CI reporting: a renamed `blocking` gate, PR-introduced-issues-only baselines, inline PR review comments, and a simpler CLI flag surface.

  **CI gate**

  - **`fail-on` is renamed to `blocking`** (CLI `--blocking <level>`, config `blocking`, GitHub Action `blocking` input). Same `error | warning | none` values, default `error`: a scan fails CI when an `error`-severity diagnostic reaches the `ciFailure` surface; `warning` blocks on any diagnostic; `none` stays advisory (always exits 0). `--fail-on` / `failOn` still work as a deprecated, warned alias hidden from `--help`.
  - `--blocking warning` now wins over `--no-warnings` (it previously silently no-op'd the gate — you can't block on warnings you've hidden).

  **Baseline — report only the issues a PR introduces (Codecov-style)**

  - In `--diff <base>` mode, react-doctor runs a second lint pass over the changed files as they existed at the base merge-base and reports only the diagnostics the change introduced; pre-existing findings that merely shifted lines are matched out by a content fingerprint (`file + rule + flagged-line hash`). The head project-health **score is unchanged**; the gate fails on newly-introduced errors only. If the baseline can't be computed (base unreachable, or a lint pass failed), the run degrades to a plain diff — all findings stay visible and CI isn't gated on findings whose new-vs-pre-existing attribution is unknown.
  - **New core API:** `computeDiagnosticDelta`, `Git.showRefContent` / `Git.mergeBase`, `materializeSourceTree`, and `InspectOptions.baseline` / `InspectResult.baselineDelta`.
  - **JSON report v2:** baseline runs emit `schemaVersion: 2` with a `baseline` block (`newCount`, `fixedCount`, `baseTotalCount`) and `mode: "baseline"`; `summary.score` stays the head score. v1 reports are unchanged.

  **GitHub Action**

  - Posts **inline PR review comments** on the changed lines that triggered each diagnostic (with fix guidance + a docs link), plus a restyled CLI-style sticky summary with linkable findings and the new / fixed delta. The `annotations` input was removed.
  - On pull requests it fetches the base commit for baselining — use `fetch-depth: 0` on `actions/checkout`. New `fixed-issues` output. Defaults: `project: "*"`, `node-version: 24`.

  **CLI flags (fewer flags, fewer footguns)**

  - `--explain` / `--why` → the `react-doctor why <file>:<line>` subcommand (`rules explain <rule>` still explains what a rule means).
  - Removed `--full` (use `--diff false` to force a full scan), `--pr-comment` (the Action renders its comment from `--json`), and the positive `--respect-inline-disables` (already the default; use `--no-respect-inline-disables` for audit mode). The internal `--changed-files-from` is hidden from `--help`.
  - Removed flags now fail with a migration error instead of being silently dropped, and an empty `--project` filter (e.g. `--project ","`) is rejected.

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.4.0

## 0.2.19

### Patch Changes

- Updated dependencies [[`eba20ae`](https://github.com/millionco/react-doctor/commit/eba20ae9a708af81c7d95dbdadf16c8e5c6d21f9), [`5d7b36b`](https://github.com/millionco/react-doctor/commit/5d7b36bc315ba4c0a8ba6b60bd781a11efbed94f)]:
  - oxlint-plugin-react-doctor@0.3.0

## 0.2.18

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.18

## 0.2.17

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.17

## 0.2.16

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.16

## 0.2.15

### Patch Changes

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Collapse diagnostic categories into five clear, outcome-based buckets: **Security**, **Bugs**, **Performance**, **Accessibility**, and **Maintainability**. The previous fine-grained labels (Correctness, State & Effects, React Compiler, Next.js, React Native, Server, TanStack Query/Start, Preact → Bugs; Bundle Size → Performance; Architecture/Design → Maintainability) now roll up so the scan output reads as plain issue types at a glance.

  This changes the `category` value on every diagnostic (CLI output, the per-error headline prefix like `Security: Use of eval()`, and JSON/programmatic output). If you key `categories` severity overrides off the old names, update them to the new buckets. Dead-code findings (unused files/exports/dependencies, circular imports) now report `Maintainability` instead of `Dead Code`. Bundle-size findings now sort with `Performance` (higher stakes) rather than near the bottom of the top-errors block.

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Fix dead-code analysis silently failing ("Scanning failed (dead-code analysis, non-fatal).") on type-heavy projects. deslop's semantic pass builds a full TypeScript program and walks every identifier through the type checker; on projects with large generic types (tRPC routers, Effect/Zod schemas, deep generics) the checker instantiates enormous types and the child process exceeds Node's default ~4 GB heap, dying with an uncatchable "JavaScript heap out of memory" that surfaced as empty worker output and a non-fatal scan failure. The dead-code worker child is now spawned with `--max-old-space-size=8192` so those projects complete instead of crashing.

- Updated dependencies [[`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7), [`75c1f99`](https://github.com/millionco/react-doctor/commit/75c1f99e062a8fc3e5e4ba294208dbc56bca5f6f)]:
  - oxlint-plugin-react-doctor@0.2.15

## 0.2.14

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.14

## 0.2.13

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.13

## 0.2.12

### Patch Changes

- Updated dependencies [[`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de), [`d0f5206`](https://github.com/millionco/react-doctor/commit/d0f52062e09c7bfe11eda2c06ad6e9ab0ab7da58), [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb)]:
  - oxlint-plugin-react-doctor@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies [[`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163)]:
  - oxlint-plugin-react-doctor@0.2.11

## 0.2.10

### Patch Changes

- Add Preact project detection and capability wiring. Scans now distinguish pure Preact projects from `preact/compat` setups and still enable Preact rules for Vite + Preact projects where the build framework remains `vite`.

- Add React minor-version capability parsing for APIs that ship after a major release. `react:19.2` now gates the `<Activity>` rule instead of enabling it for every React 19 project.

- Fix dead-code scan freezes by running analysis through a bounded worker path and continuing the inspect pipeline when analysis stalls or errors.

- Carry the latest rule-plugin capability updates through core, including Preact, Jotai, React Native performance, JS performance, HTML correctness, accessibility, and state-and-effects checks.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.10`.

## 0.2.9

### Patch Changes

- Dependency bump: `oxlint-plugin-react-doctor@0.2.9`.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.8

## 0.2.7

### Patch Changes

- Unify the dual diagnostic-filter pipelines into a single `buildDiagnosticPipeline` source of truth, removing a longstanding divergence between CLI and API filtering.

- Wire the `Progress` service into `runInspect`, eliminating the manual spinner `Ref` plumbing that leaked implementation details into renderers.

- Move scattered magic numbers into `constants.ts` with unit-suffixed `SCREAMING_SNAKE_CASE` names per project conventions.

- Consolidate `isProjectBoundary` helpers and rename the event-handler `isFunctionLike` to avoid collision with the oxlint plugin's AST utility of the same name.

- Push score-surface filtering into `runInspect` so downstream consumers no longer need to re-apply surface filters.

- Add `resolveScanTarget` helper and share `restoreLegacyThrow` across CLI and API entry points.

- Emit automated agent guidance (issue-reporting links) in inspect output for AI-assisted workflows.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.7

## 0.2.6

### Patch Changes

- Inherit the `design-no-bold-heading` rule removal from `oxlint-plugin-react-doctor@0.2.6`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.6

## 0.2.5

### Patch Changes

- Add `require-pnpm-hardening` environment check that warns when `pnpm` is detected without strict lockfile settings, helping prevent phantom dependency issues.

- Cover child workspace diff include paths so `--diff` mode in monorepos correctly scans files changed inside nested workspace packages, not just the root.

- Fix Node 20 runtime dependency support so the core package resolves correctly without Node 22+ built-ins.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.5

## 0.2.4

### Patch Changes

- **Effect v4 foundation.** Introduce tagged error classes (`Schema.TaggedErrorClass`), `Schema.Class` wire records for diagnostics and reports, `Context.Reference` for ambient config, and branded `Schema.brand` paths (`OxlintBinaryPath`, `NodeBinaryPath`). All fallible operations now fail with `ReactDoctorError` carrying a `reason` union that renderers dispatch on via `Effect.catchReasons`.

- **10 Effect v4 services.** Stand up `Files`, `Git`, `Project`, `Config`, `Linter`, `DeadCode`, `Score`, `Reporter`, `Progress`, and `NodeResolver` as `Context.Service` classes with `layerNode` / `layerOf` / `layerCapture` / `layerNoop` test variants.

- **`runInspect` streaming orchestrator.** Replace the imperative scan loop with a per-element pipeline that streams diagnostics through `buildDiagnosticPipeline`, enabling concurrent lint + dead-code analysis and real-time progress reporting.

- **Collapse `@react-doctor/types` and `@react-doctor/project-info` into `@react-doctor/core`**, reducing the workspace package count and simplifying imports.

- **Opt-in OpenTelemetry export.** Set `REACT_DOCTOR_OTLP_ENDPOINT` and `REACT_DOCTOR_OTLP_AUTH_HEADER` to ship every `Effect.fn("Service.method")` span and top-level `Effect.withSpan` to an OTLP-compatible backend.

- **User-plugin extension.** `config.plugins: [...]` loads additional oxlint plugin packages alongside the built-in rule set so teams can ship custom rules.

- **Security fixes.** Pin CI workflow permissions, add fork guards, fix four pre-existing audit findings.

- **Adopt `Effect.Console` throughout.** Drop the custom `Logger` service; renderers and services use `Console.log` / `Console.warn` / `Console.error` from `effect/Console`, which is swappable for tests via `Console.Console` service override.

- **Git service.** DI-wrap every `spawnSync('git', ...)` call site behind the `Git` service, then replace `spawnSync` with Effect's `ChildProcess` for non-blocking execution.

- **`NodeResolver` + `StagedFiles` services.** Remove the last `Effect.runSync` hack from `Linter.layerOxlint` by lifting Node resolution and staged-file discovery into their own services.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.4

## 0.2.3

### Patch Changes

- Fix vite build configuration for bundling workspace dependencies so `@react-doctor/core` resolves internal imports correctly at publish time.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.3
  - @react-doctor/project-info@0.2.3
  - @react-doctor/types@0.2.3

## 0.2.2

### Patch Changes

- Restore `eslint-plugin-react-hooks` as a hard dependency so React Compiler rules resolve without requiring users to install the peer separately.

- [#273](https://github.com/millionco/react-doctor/pull/273) [`47772b7`](https://github.com/millionco/react-doctor/commit/47772b7da4f6e412b09e3a4f74d888307faf74a1) - Natively port the 8 rules from `eslint-plugin-react-you-might-not-need-an-effect`
  (NickvanDyke, MIT) into `oxlint-plugin-react-doctor`. They now ship as
  `react-doctor/*` rules and no longer require the optional peer
  dependency. The optional peer-dep surface (`effect/*` rules,
  `resolveYouMightNotNeedEffectPlugin`,
  `YOU_MIGHT_NOT_NEED_EFFECT_NAMESPACE`) is removed from
  `@react-doctor/core`.

  The ports use a real `eslint-scope` ScopeManager (cached per Program
  via `WeakMap`) - same `references` / `resolved.defs[].node.init` /
  `isEventualCallTo` chasing the upstream plugin uses. Diagnostic
  messages match upstream verbatim with template variables substituted
  in JS.

  | Rule (now `react-doctor/<id>`)      | What it catches                                                          |
  | ----------------------------------- | ------------------------------------------------------------------------ |
  | `no-derived-state`                  | Storing derived state via a useEffect instead of computing during render |
  | `no-chain-state-updates`            | Chaining state updates across effects                                    |
  | `no-event-handler`                  | Using state + a guarded effect as an event handler                       |
  | `no-adjust-state-on-prop-change`    | Adjusting state in an effect when a prop changes                         |
  | `no-reset-all-state-on-prop-change` | Resetting all state in an effect (use a `key` prop)                      |
  | `no-pass-live-state-to-parent`      | Pushing live state to a parent via a callback in an effect               |
  | `no-pass-data-to-parent`            | Passing fetched data to a parent via a callback in an effect             |
  | `no-initialize-state`               | Initializing state inside a mount-only effect                            |

  Parity coverage: 195 of 196 upstream test cases pass (the 1 remaining
  case is upstream's own `todo: true`, "Set derived state via identical
  intermediate setter").

  These coexist with React Doctor's existing thematically-related rules
  (`no-derived-state-effect`, `no-effect-chain`, `no-event-trigger-state`,
  `no-prop-callback-in-effect`) - different IDs, different shapes,
  different messages.

- Updated dependencies [[`47772b7`](https://github.com/millionco/react-doctor/commit/47772b7da4f6e412b09e3a4f74d888307faf74a1)]:
  - oxlint-plugin-react-doctor@0.2.2
  - @react-doctor/project-info@0.2.2
  - @react-doctor/types@0.2.2

## 0.2.1

### Patch Changes

- Make filesystem walks tolerate EPERM/EACCES (macOS Library)

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.1
  - @react-doctor/project-info@0.2.1
  - @react-doctor/types@0.2.1

## 0.2.0

### Minor Changes

- [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758) - Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

- [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0) - Extract project / dependency / framework detection, the oxlint runner +
  scoring engine, and the shared TypeScript type layer out of the
  `react-doctor` monolith into three new public workspace packages:
  `@react-doctor/types`, `@react-doctor/project-info`, and
  `@react-doctor/core` ([#249](https://github.com/millionco/react-doctor/issues/249)). The oxlint plugin is restructured into
  per-rule modules under `src/plugin/rules/<category>/<rule>.ts` with a
  codegen'd `rule-registry.ts` ([#218](https://github.com/millionco/react-doctor/issues/218), [#228](https://github.com/millionco/react-doctor/issues/228), [#230](https://github.com/millionco/react-doctor/issues/230), [#231](https://github.com/millionco/react-doctor/issues/231), [#234](https://github.com/millionco/react-doctor/issues/234), [#235](https://github.com/millionco/react-doctor/issues/235), [#236](https://github.com/millionco/react-doctor/issues/236),
  [#242](https://github.com/millionco/react-doctor/issues/242)). Land the user-feedback sweep ([#208](https://github.com/millionco/react-doctor/issues/208)): scoring transparency hooks,
  per-rule severity + rule-set selection config options, and reduced
  false positives across the design / Tailwind / state-and-effects rule
  families. Reorganise the CLI into `cli/commands/` + `cli/utils/`
  ([#250](https://github.com/millionco/react-doctor/issues/250)), and forward `reactMajorVersion` through programmatic
  `diagnose()` ([#174](https://github.com/millionco/react-doctor/issues/174)).

### Patch Changes

- [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c) - Rule-fix wave for the 0.2.0-beta.5 release:

  - Scope `no-secrets-in-client-code` to client-reachable bindings -
    skips server-only modules, public env-prefixed values, and
    locally-classified safe files ([#252](https://github.com/millionco/react-doctor/issues/252)).
  - `nextjs-no-side-effect-in-get-handler` stops flagging
    `response.headers.set(...)` and locally-constructed `Map` / `Set` /
    `Headers` inside GET handlers; the same safe-bindings classifier
    benefits `server-auth-actions` and the TanStack Start
    `get-mutation` rule ([#260](https://github.com/millionco/react-doctor/issues/260)).
  - `async-defer-await` no longer reports awaits inside destructured
    patterns with defaults, bare-statement early-returns, or awaits
    guarded by an earlier `if … return …` ([#265](https://github.com/millionco/react-doctor/issues/265)).
  - `js-length-check-first` detects length guards anywhere earlier in
    an `&&` chain, not only as the immediate left operand ([#269](https://github.com/millionco/react-doctor/issues/269)).
  - `async-parallel` is suppressed in test files, browser-fixture /
    Playwright helpers, and ordered UI flows where serial awaits are
    deliberate ([#270](https://github.com/millionco/react-doctor/issues/270)).
  - `js-combine-iterations` skips lazy `Iterator` helper chains
    (`Iterator.from`, `Iterator.prototype.{map,filter,take,drop,…}`)
    whose evaluation semantics differ from `Array.prototype` ([#272](https://github.com/millionco/react-doctor/issues/272),
    resolves [#205](https://github.com/millionco/react-doctor/issues/205)).
  - `no-prevent-default` is framework-aware: Remix / Next.js
    progressive-enhancement form handlers, synthetic event types with
    no documented alternative, and form `onSubmit` handlers that
    subsequently call `fetch` / a server action no longer trip ([#274](https://github.com/millionco/react-doctor/issues/274)).
  - New per-surface diagnostic controls in `@react-doctor/core` +
    `react-doctor`: design and Tailwind cleanup categories are demoted
    from the default PR-comment surface while staying visible in the
    CLI report and at the CI failure gate ([#271](https://github.com/millionco/react-doctor/issues/271)).

- [#284](https://github.com/millionco/react-doctor/pull/284) [`b34c5c4`](https://github.com/millionco/react-doctor/commit/b34c5c4db28539d9407fc08600e0e8c28dea67cd) - Harden glob pattern compilation against ReDoS:

  - Replace the hand-rolled glob-to-regex compiler with [`picomatch`](https://github.com/micromatch/picomatch), the proven matcher behind `chokidar`, `fast-glob`, and `micromatch`. The previous compiler turned patterns like `**/**/**/**/**/foo.tsx` into nested optional `(?:.+/)?` groups whose backtracking is exponential in the number of `**` segments - a 20-deep pattern hung for over 30 seconds on a 60-character non-matching input.
  - Reject obviously pathological patterns early with a clear `InvalidGlobPatternError` carrying the offending pattern and a human-readable reason, instead of crashing the scan. Limits live in `@react-doctor/core/constants` (`MAX_GLOB_PATTERN_LENGTH_CHARS = 1024`, `MAX_GLOB_PATTERN_WILDCARD_COUNT = 24`) and bound worst-case work regardless of the underlying engine. Real-world ignore patterns like `**/foo/**/bar/**/*.tsx` sit well under the cap.
  - Surface invalid `ignore.files` and `ignore.overrides[*].files` entries as `[react-doctor] …` warnings on stderr and skip just the bad pattern, so a single typo no longer takes the whole scan down.
  - Add regression tests covering the worst-case patterns (deeply-stacked globstars and dense `a*a*a*…` alternations) and the validation surface.

- [#266](https://github.com/millionco/react-doctor/pull/266) [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255) - Scope React Native rules to per-package boundaries. Previously every
  `rn-*` rule fired on every file in a project whose top-level framework
  was detected as React Native or Expo - even on sibling workspaces that
  were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
  alongside `apps/web` and `packages/storybook`) the rules would noisily
  report issues against Next.js, Vite, Docusaurus, Storybook, and plain
  React DOM packages where they don't apply.

  React Native rules now walk up to the file's nearest `package.json`
  before running. The rule body is skipped when the package declares a
  web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
  `@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
  `react-dom` without an RN sibling) and stays active when the package
  declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
  `react-native-macos`, anything under the `@react-native/` or
  `@react-native-` community namespaces (`@react-native-firebase/*`,
  `@react-native-async-storage/*`, `@react-native-community/*`, …), or
  Metro's top-level `"react-native"` resolution field.

  The detection is bidirectional: a web-rooted monorepo (root
  `package.json` declares `next` or `vite`) still loads `rn-*` rules
  when any workspace targets React Native or Expo, so the rules now
  fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
  layout that the file-level boundary alone covered.

  `rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
  branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
  `Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
  case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
  Optional chaining (`Platform?.OS`) and the TS non-null assertion
  (`Platform.OS!`) parse the same way as the bare form. The walker stops
  at function and `Program` boundaries so JSX defined inside a callback
  hoisted out of a `Platform.OS` branch does not inherit the parent
  guard.

  Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
  keep the rule active even when the surrounding package classification
  is ambiguous.

- [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c) - False-positive sweep across the rule plugin and the oxlint runner:

  - Gate React-19-only rules on the detected React major version so they
    stay silent on React 18 projects, with hardened catalog / peer-range /
    workspace traversal in `@react-doctor/project-info` ([#254](https://github.com/millionco/react-doctor/issues/254)).
  - Treat early-return guards as render-reachable state reads so
    `rerender-state-only-in-handlers` / `no-event-trigger-state` stop
    recommending `useRef` for state that gates render output ([#255](https://github.com/millionco/react-doctor/issues/255)).
  - Narrow `no-effect-event-handler` - DOM imperatives, prop callbacks
    invoked from effects, and side effects routed through a stable ref
    are no longer reclassified as handler-only ([#256](https://github.com/millionco/react-doctor/issues/256)).
  - Suppress rules-of-hooks diagnostics on locally-defined `useX`
    helpers that are not React hooks, and add the `no-em-dash-in-jsx-text`
    / `no-three-period-ellipsis` typography rules ([#257](https://github.com/millionco/react-doctor/issues/257)).
  - Collapse duplicate oxlint diagnostics and recover diagnostics from
    large monorepo projects via batched runs + a new
    `dedupe-diagnostics` helper in `@react-doctor/core` ([#262](https://github.com/millionco/react-doctor/issues/262)).

- Updated dependencies [[`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255), [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758), [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0)]:
  - oxlint-plugin-react-doctor@0.2.0
  - @react-doctor/project-info@0.2.0
  - @react-doctor/types@0.2.0

## 0.2.0-beta.6

### Minor Changes

- Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

### Patch Changes

- [#284](https://github.com/millionco/react-doctor/pull/284) [`b34c5c4`](https://github.com/millionco/react-doctor/commit/b34c5c4db28539d9407fc08600e0e8c28dea67cd) - Harden glob pattern compilation against ReDoS:

  - Replace the hand-rolled glob-to-regex compiler with [`picomatch`](https://github.com/micromatch/picomatch), the proven matcher behind `chokidar`, `fast-glob`, and `micromatch`. The previous compiler turned patterns like `**/**/**/**/**/foo.tsx` into nested optional `(?:.+/)?` groups whose backtracking is exponential in the number of `**` segments - a 20-deep pattern hung for over 30 seconds on a 60-character non-matching input.
  - Reject obviously pathological patterns early with a clear `InvalidGlobPatternError` carrying the offending pattern and a human-readable reason, instead of crashing the scan. Limits live in `@react-doctor/core/constants` (`MAX_GLOB_PATTERN_LENGTH_CHARS = 1024`, `MAX_GLOB_PATTERN_WILDCARD_COUNT = 24`) and bound worst-case work regardless of the underlying engine. Real-world ignore patterns like `**/foo/**/bar/**/*.tsx` sit well under the cap.
  - Surface invalid `ignore.files` and `ignore.overrides[*].files` entries as `[react-doctor] …` warnings on stderr and skip just the bad pattern, so a single typo no longer takes the whole scan down.
  - Add regression tests covering the worst-case patterns (deeply-stacked globstars and dense `a*a*a*…` alternations) and the validation surface.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.6
  - @react-doctor/types@0.2.0-beta.6
  - @react-doctor/project-info@0.2.0-beta.6

## 0.2.0-beta.5

### Patch Changes

- [#252](https://github.com/millionco/react-doctor/pull/252) [`2d90c1c`](https://github.com/millionco/react-doctor/commit/2d90c1c5ae6d901913a575d40a784058478479ec) - Add public env-prefix detection (`get-public-env-prefix.ts`) and a
  recommendation builder (`build-no-secrets-recommendation.ts`) so
  client-secret diagnostics are scoped to actually client-reachable
  bindings instead of every string literal in the project.
  `run-oxlint.ts` and `runners/oxlint/config.ts` pass the detected
  prefix and the file-exposure classification through to the
  `no-secrets-in-client-code` rule.

- [#260](https://github.com/millionco/react-doctor/pull/260) [`b53d873`](https://github.com/millionco/react-doctor/commit/b53d8730459d2dc469a8f9841def231048c8de7e) - `run-oxlint.ts` + `runners/oxlint/config.ts` thread the new
  locally-scoped-safe-bindings classification through to the GET
  handler rule so `response.headers` and locally-constructed `Map` /
  `Set` / `Headers` no longer fail the Next.js GET-handler diagnostic.

- [#271](https://github.com/millionco/react-doctor/pull/271) [`7a7ec84`](https://github.com/millionco/react-doctor/commit/7a7ec84fad631d96f70279394be5f086b8424d17) - **Per-surface diagnostic filtering.** New public API:
  `diagnostic-surface.ts` (the `DiagnosticSurface` type - `pr-comment`,
  `cli`, `ci-failure-gate`), `filter-for-surface.ts` (filter a
  diagnostic list to those allowed on a given surface), and extended
  `validate-config-types.ts` with `surfaces.*` schema. Consumers can
  now demote whole categories (design, Tailwind cleanup) from default
  PR comments while keeping them visible in the CLI report and the
  CI gate. Exported from `packages/core/src/index.ts`.

- [#266](https://github.com/millionco/react-doctor/pull/266) [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255) - Scope React Native rules to per-package boundaries. Previously every
  `rn-*` rule fired on every file in a project whose top-level framework
  was detected as React Native or Expo - even on sibling workspaces that
  were clearly web targets. In a mixed RN + web monorepo (`apps/mobile`
  alongside `apps/web` and `packages/storybook`) the rules would noisily
  report issues against Next.js, Vite, Docusaurus, Storybook, and plain
  React DOM packages where they don't apply.

  React Native rules now walk up to the file's nearest `package.json`
  before running. The rule body is skipped when the package declares a
  web-only framework (`next`, `vite`, `react-scripts`, `gatsby`,
  `@remix-run/react`, `@docusaurus/core`, `@storybook/*`, or plain
  `react-dom` without an RN sibling) and stays active when the package
  declares `react-native`, `expo`, `react-native-tvos`, `react-native-windows`,
  `react-native-macos`, anything under the `@react-native/` or
  `@react-native-` community namespaces (`@react-native-firebase/*`,
  `@react-native-async-storage/*`, `@react-native-community/*`, …), or
  Metro's top-level `"react-native"` resolution field.

  The detection is bidirectional: a web-rooted monorepo (root
  `package.json` declares `next` or `vite`) still loads `rn-*` rules
  when any workspace targets React Native or Expo, so the rules now
  fire on `apps/mobile` of a `next`-rooted repo as well as the inverse
  layout that the file-level boundary alone covered.

  `rn-no-raw-text` additionally skips raw text inside `Platform.OS === "web"`
  branches: `if`, `?:`, and `&&` / `||` short-circuits, the mirror
  `Platform.OS !== "web"` else branches, `switch (Platform.OS) { case "web": … }`
  case bodies, and the `web` arm of `Platform.select({ web: …, default: … })`.
  Optional chaining (`Platform?.OS`) and the TS non-null assertion
  (`Platform.OS!`) parse the same way as the bare form. The walker stops
  at function and `Program` boundaries so JSX defined inside a callback
  hoisted out of a `Platform.OS` branch does not inherit the parent
  guard.

  Native-only file extensions (`.ios.tsx`, `.android.tsx`, `.native.tsx`)
  keep the rule active even when the surrounding package classification
  is ambiguous.

- Updated dependencies [[`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255)]:
  - oxlint-plugin-react-doctor@0.2.0-beta.5
  - @react-doctor/project-info@0.2.0-beta.3
  - @react-doctor/types@0.2.0-beta.3

## 0.2.0-beta.4

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- [#249](https://github.com/millionco/react-doctor/pull/249) [`f0198e2`](https://github.com/millionco/react-doctor/commit/f0198e2f2d9560a15bdb4a78f4a378ca2ac5fcdd) - **New public package.** Extracted from the `react-doctor` monolith
  in [#249](https://github.com/millionco/react-doctor/pull/249).
  Public surface: the oxlint runner family
  (`runners/oxlint/{config,capabilities,resolve-use-call-binding}.ts`,
  `run-oxlint`, `apply-ignore-overrides`, `batch-include-paths`),
  scoring (`calculate-score`), config validation
  (`validate-config-types`, `can-oxlint-extend-config`), diagnostic
  combination / dedupe / JSON reports (`combine-diagnostics`,
  `dedupe-diagnostics`, `build-json-report`,
  `build-json-report-error`), and the
  `check-reduced-motion` / `collect-ignore-patterns` /
  `list-source-files` helpers. Consumers that previously reached into
  `react-doctor/src/utils/*` should switch to importing from
  `@react-doctor/core`.

### Patch Changes

- [#208](https://github.com/millionco/react-doctor/pull/208) [`8556b31`](https://github.com/millionco/react-doctor/commit/8556b31d8e4e165f791db0aa60a6b038b18ec777) - **User-feedback sweep.** Surface each rule's contribution to the
  project score via the new scoring transparency hooks, accept
  per-rule severity overrides, and accept a `ruleSet` selector from
  config - all without changing the public `diagnose()` signature.

- [#254](https://github.com/millionco/react-doctor/pull/254) [`bfaf9c9`](https://github.com/millionco/react-doctor/commit/bfaf9c9530a9f8761df6e2d69abcf44c1699ff77) - `runners/oxlint/capabilities.ts` now consults the detected React
  major version when deciding which capability flags to enable. The
  React-19-only rule families are switched off on React 18 projects
  so the runner stops emitting rules the project can't act on.

- [#257](https://github.com/millionco/react-doctor/pull/257) [`ffbd20f`](https://github.com/millionco/react-doctor/commit/ffbd20f3d0ebda2221d2ea93f87342165da90fdb) - Adds `runners/oxlint/resolve-use-call-binding.ts` (619 LOC binding
  resolver) and `runners/oxlint/should-suppress-local-use-hook-diagnostic.ts`
  so the runner can post-filter rules-of-hooks diagnostics that point
  at locally-defined `useX` helpers (not actually React hooks).

- [#262](https://github.com/millionco/react-doctor/pull/262) [`bca5d30`](https://github.com/millionco/react-doctor/commit/bca5d30fc549a16c4628001dcd2c5a83e85c04f8) - Eval-driven oxlint robustness pass. `run-oxlint.ts` now batches
  include paths via the new `list-source-files` helper instead of
  globbing the universe, `utils/dedupe-diagnostics.ts` collapses
  duplicate diagnostics emitted across batched runs, and the runner
  recovers diagnostics from large monorepo projects that previously
  silently dropped output. Backed by `dedupe-diagnostics.test.ts`,
  `oxlint-batching.test.ts`, and `build-json-report.test.ts`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.2
  - @react-doctor/project-info@0.2.0-beta.2
  - @react-doctor/types@0.2.0-beta.2
