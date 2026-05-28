# react-doctor

## 0.2.11

### Patch Changes

- Updated dependencies [[`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163)]:
  - oxlint-plugin-react-doctor@0.2.11

## 0.2.10

### Patch Changes

- Add Preact project detection so `react-doctor inspect` recognizes Preact workspaces, including Vite + Preact projects that still report `vite` as their framework, and enables the bundled Preact rule family.

- Bundle new diagnostics across the rule set: Preact compatibility checks, HTML correctness and dialog accessibility rules, `hooks-no-nan-in-deps`, Jotai atom diagnostics, React Native performance rules, `js-async-reduce-without-awaited-acc`, and React 19.2 `<Activity>` effect-boundary checks.

- Fix CLI reliability around dead-code scans and setup prompts. Dead-code analysis now runs with a bounded worker path instead of freezing the scan, monorepo scans still show the setup prompt, and repeated setup questions collapse into one install flow.

- Inherit false-positive fixes for `control-has-associated-label` and `no-giant-component`.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.10`.

## 0.2.9

### Patch Changes

- Publish workflow now uses npm trusted publishing through GitHub OIDC, including an npm version with provenance support. Releases no longer need a long-lived npm token.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.9`.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.8

## 0.2.7

### Patch Changes

- **Animated score progress bar.** The CLI health score now renders with a smooth progress-bar animation, automatically skipped in CI and coding-agent environments.

- **CI and agent detection.** New `isCiOrAgent` utility detects CI providers and coding agents (Cursor, Claude Code, Codex, etc.) and suppresses interactive prompts, animations, and the onboarding flow so scans run non-interactively where appropriate.

- **Concurrent lint + dead-code analysis.** The `inspect` command now runs linting and dead-code detection in parallel instead of sequentially, reducing wall-clock scan time.

- **Agent install hint.** When running inside a coding agent, the CLI suggests `react-doctor install` to set up the agent skill for in-editor diagnostics.

- **Skip prefilled project question.** The monorepo project-selection prompt is skipped when there is only one scannable project, removing an unnecessary interactive step.

- **`/doctor` triage skill.** The React Doctor agent skill now includes a `/doctor` command that fetches the canonical playbook for full-project triage.

- Bundle `eslint-plugin-react-hooks` as a direct dependency so React Compiler rules work out of the box.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.7

## 0.2.6

### Patch Changes

- Remove `design-no-bold-heading` rule - the heuristic produced too many false positives in design systems where headings intentionally vary weight.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.6

## 0.2.5

### Patch Changes

- **First-run onboarding.** New users see a brief walkthrough on their first `react-doctor` invocation explaining what the tool does and how to read the report.

- **Node 20 support.** Fix runtime dependency resolution so the CLI runs correctly on Node 20 without requiring Node 22+ built-ins.

- Cover child workspace diff include paths so `--diff` mode in monorepos correctly scans files changed inside nested workspace packages.

- Stop `jsx-key` from flagging shorthand JSX fragments (`<>...</>`) which cannot accept a `key` prop.

- Normalize static template literal handling so rules treat `` `hello` `` the same as `"hello"`.

- Add `require-pnpm-hardening` environment check that warns when `pnpm` is detected without strict lockfile settings.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.5

## 0.2.4

### Patch Changes

- **Effect v4 runtime migration.** The entire scan pipeline is rebuilt on Effect v4 - tagged errors, dependency-injected services, generator-based control flow, and `Context.Reference` ambient config replace the previous imperative architecture.

- **New `@react-doctor/api` package.** Programmatic `diagnose()` entry point backed by the same `runInspect` orchestrator the CLI uses, with typed `ReactDoctorError` failures and `Effect.catchReasons` dispatch.

- **`inspect()` rewired through `runInspect`.** The CLI `inspect` command now delegates to the core streaming orchestrator instead of managing the scan loop directly, aligning CLI and API behavior.

- **Native agent hook installer.** `react-doctor install` writes post-checkout / post-merge git hooks that auto-run the scan on relevant file changes.

- **Opt-in OpenTelemetry.** `REACT_DOCTOR_OTLP_ENDPOINT` + `REACT_DOCTOR_OTLP_AUTH_HEADER` ship every service span to an OTLP backend.

- **User-plugin extension.** `config.plugins: [...]` loads custom oxlint plugin packages alongside the built-in rules.

- **Security hardening.** Pin CI workflow permissions, add fork guards, fix four pre-existing audit findings.

- Collapse `@react-doctor/types` and `@react-doctor/project-info` into `@react-doctor/core`.

- Adopt `Effect.Console` throughout - drop the custom `Logger` service.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.4

## 0.2.3

### Patch Changes

- Fix vite build configuration for bundling workspace dependencies so `npx react-doctor` resolves internal workspace imports correctly.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.3

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

## 0.2.1

### Patch Changes

- Make filesystem walks tolerate EPERM/EACCES (macOS Library)

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.1

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

- [`29b7229`](https://github.com/millionco/react-doctor/commit/29b7229ea144cfe80c4401391eed3aa035071bcd) - Add `oxlint-plugin-react-doctor` to `dependencies` so it is installed
  alongside the CLI. The bundler correctly externalises the plugin (oxlint
  loads it by file path at runtime) but it was missing from the published
  dependency list, causing `ERR_MODULE_NOT_FOUND` on `npx react-doctor`.

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

- [`10d5de8`](https://github.com/millionco/react-doctor/commit/10d5de804fe9c03fa9f18e5350bb26965a5108ac) - Fix workspace packages not being bundled into dist, causing
  `ERR_MODULE_NOT_FOUND: Cannot find package '@react-doctor/core'`
  when running the published CLI.

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

- [#202](https://github.com/millionco/react-doctor/pull/202) [`53fa4df`](https://github.com/millionco/react-doctor/commit/53fa4dffe837e0157fb850fef700fccaaec191ea) - Detect the project's Tailwind version (`tailwindcss` in `package.json`,
  including pnpm and Bun catalog references) and gate Tailwind-aware
  rules on it. `design-no-redundant-size-axes` (which suggests collapsing
  `w-N h-N` → `size-N`) now stays silent on Tailwind v3.0 … v3.3 - those
  versions predate the `size-N` shorthand and the suggestion would
  generate classes that don't compile. The rule still fires on Tailwind
  v3.4+, v4+, and when the Tailwind version cannot be resolved.

  A new `tailwindVersion` field is added to `ProjectInfo` and printed
  during scans so it's visible alongside the detected React version and
  framework.

- Updated dependencies [[`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`529015d`](https://github.com/millionco/react-doctor/commit/529015d1d89441c4708f49413ecd540db7c04255), [`5be2ead`](https://github.com/millionco/react-doctor/commit/5be2eadd90b2248b28b228fad306808cec1bf758), [`99f6a6a`](https://github.com/millionco/react-doctor/commit/99f6a6ad1cc41828172b26f17a84bcf2d66ff17c), [`809e38c`](https://github.com/millionco/react-doctor/commit/809e38cebabc15c42b3c40ee8c7a753c3d7549d0)]:
  - oxlint-plugin-react-doctor@0.2.0

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

## 0.2.0-beta.5

### Patch Changes

- [#271](https://github.com/millionco/react-doctor/pull/271) [`7a7ec84`](https://github.com/millionco/react-doctor/commit/7a7ec84fad631d96f70279394be5f086b8424d17) - **Per-surface diagnostic controls (CLI).** New
  `cli/utils/inspect-flags.ts` flag + companion
  `cli/utils/resolve-cli-inspect-options.ts` and
  `cli/utils/validate-mode-flags.ts` plumbing wire the new
  `@react-doctor/core` surface filter into `cli/commands/inspect.ts`
  and `inspect.ts`. Design + Tailwind cleanup categories are demoted
  from the default PR-comment surface so they no longer dominate code
  review output, while still appearing in the CLI report and at the
  CI failure gate. Documented in the package README and the new
  `action.yml` knobs.

- Inherits the rule-fix wave from
  `oxlint-plugin-react-doctor@0.2.0-beta.5` (rules are bundled into
  the CLI):
  `no-secrets-in-client-code` scoping
  ([#252](https://github.com/millionco/react-doctor/pull/252)),
  `nextjs-no-side-effect-in-get-handler` safe local bindings
  ([#260](https://github.com/millionco/react-doctor/pull/260)),
  `async-defer-await` false-positive fixes
  ([#265](https://github.com/millionco/react-doctor/pull/265)),
  `js-length-check-first` `&&`-chain detection
  ([#269](https://github.com/millionco/react-doctor/pull/269)),
  `async-parallel` test / browser-fixture suppression
  ([#270](https://github.com/millionco/react-doctor/pull/270)),
  `js-combine-iterations` lazy `Iterator` skip
  ([#272](https://github.com/millionco/react-doctor/pull/272)), and
  `no-prevent-default` framework awareness
  ([#274](https://github.com/millionco/react-doctor/pull/274)).

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

## 0.2.0-beta.4

### Patch Changes

- Add `oxlint-plugin-react-doctor` to `dependencies` so it is installed
  alongside the CLI. The bundler correctly externalises the plugin (oxlint
  loads it by file path at runtime) but it was missing from the published
  dependency list, causing `ERR_MODULE_NOT_FOUND` on `npx react-doctor`.
- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- [`10d5de8`](https://github.com/millionco/react-doctor/commit/10d5de804fe9c03fa9f18e5350bb26965a5108ac) - Fix workspace packages
  (`@react-doctor/core`, `@react-doctor/project-info`,
  `@react-doctor/types`) not being bundled into the published `dist/`
  output, which caused
  `ERR_MODULE_NOT_FOUND: Cannot find package '@react-doctor/core'`
  on `npx react-doctor` after the package extraction in beta.2.
  Vite config now treats the workspace dependencies as bundle-time
  inputs.

- Inherits the
  [#253](https://github.com/millionco/react-doctor/pull/253) `no-barrel-import`
  index-resolution fix from
  `oxlint-plugin-react-doctor@0.2.0-beta.3` (rules are bundled into
  the CLI).

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- [#249](https://github.com/millionco/react-doctor/pull/249) [`f0198e2`](https://github.com/millionco/react-doctor/commit/f0198e2f2d9560a15bdb4a78f4a378ca2ac5fcdd) - **Internal-package extraction.** The CLI no longer vendors project
  detection, the oxlint runner, scoring, or the shared type layer
  inline - those modules now live in
  `@react-doctor/types`, `@react-doctor/project-info`, and
  `@react-doctor/core` and are consumed as workspace dependencies.
  Bundled into `dist/` on publish (see also
  [#253](https://github.com/millionco/react-doctor/pull/253) bundler
  follow-up in beta.3). The `react-doctor`, `react-doctor inspect`,
  and `react-doctor install` binaries are surface-compatible with
  0.1.6.

- [#250](https://github.com/millionco/react-doctor/pull/250) [`6e2ee9d`](https://github.com/millionco/react-doctor/commit/6e2ee9d474fddbde4c1246ff65b2f3e5bb3a42fc) - **CLI reorganised.** `src/cli/` is now split into `commands/` +
  `utils/`, mirroring the layout ported from `react-grab`. Each
  subcommand has a dedicated module (`inspect`, `install`, version /
  help). No user-visible change to flags or output.

### Patch Changes

- [#208](https://github.com/millionco/react-doctor/pull/208) [`8556b31`](https://github.com/millionco/react-doctor/commit/8556b31d8e4e165f791db0aa60a6b038b18ec777) - **User-feedback sweep.** Reduce false positives across the design /
  Tailwind / state-and-effects rule groups, surface per-rule scoring
  contributions in `react-doctor inspect`, and add `--severity` /
  `--rule-set` CLI options plus their `react-doctor.config.json`
  counterparts. Closes the bulk of the feedback collected on 0.1.x.

- [#174](https://github.com/millionco/react-doctor/pull/174) - Forward
  `reactMajorVersion` through the programmatic `diagnose()` entry
  point so embedders running react-doctor inside their own pipeline
  (Vercel AI Code Review sandbox and friends) get the same React-19
  rule gating the CLI gets.

- [#202](https://github.com/millionco/react-doctor/pull/202) [`53fa4df`](https://github.com/millionco/react-doctor/commit/53fa4dffe837e0157fb850fef700fccaaec191ea) - Detect the project's Tailwind version (`tailwindcss` in `package.json`,
  including pnpm and Bun catalog references) and gate Tailwind-aware
  rules on it. `design-no-redundant-size-axes` (which suggests collapsing
  `w-N h-N` → `size-N`) now stays silent on Tailwind v3.0 … v3.3 - those
  versions predate the `size-N` shorthand and the suggestion would
  generate classes that don't compile. The rule still fires on Tailwind
  v3.4+, v4+, and when the Tailwind version cannot be resolved.

  A new `tailwindVersion` field is added to `ProjectInfo` and printed
  during scans so it's visible alongside the detected React version and
  framework.

## 0.1.6

### Patch Changes

- [`e9e4217`](https://github.com/millionco/react-doctor/commit/e9e4217711341cf2bfb7c1b11f37caaae44df7c3) - Harden `discover-project` and `resolve-diagnose-target`: tighter
  workspace-root detection constants, additional regression coverage in
  `tests/diagnose.test.ts` and `tests/discover-project.test.ts` for the
  nested-subproject fallback added in 0.1.5.

## 0.1.5

### Patch Changes

- [`b06b768`](https://github.com/millionco/react-doctor/commit/b06b768) ([#193](https://github.com/millionco/react-doctor/pull/193)) - `diagnose()` now falls back to the first nested React subproject when the
  requested directory has no root `package.json`, instead of crashing with
  `No package.json found in <directory>`. This unblocks external review
  runners (e.g. the Vercel AI Code Review sandbox) that point `diagnose()`
  at the cloned repo root for projects whose `package.json` lives in a
  subfolder like `apps/web`. When neither the root nor any nested
  subdirectory contains a React project, `diagnose()` now throws a clearer
  `No React project found in <directory>` error.

- [#200](https://github.com/millionco/react-doctor/pull/200) - Typed
  errors from `diagnose()` plus a `rootDir` config option so embedders
  can target a specific subdirectory without relying on cwd inference.

- [#201](https://github.com/millionco/react-doctor/pull/201) - Integrate
  `eslint-plugin-react-you-might-not-need-an-effect` into the curated
  rule set so its useEffect-elimination diagnostics flow into the score
  alongside react-doctor's own state-and-effects rules.

- [#194](https://github.com/millionco/react-doctor/pull/194) - Resolve
  the React version from Bun grouped catalogs (in addition to pnpm
  catalogs) so monorepos using Bun for dependency hoisting still get an
  accurate React major back from the catalog resolver.

- [#196](https://github.com/millionco/react-doctor/pull/196) - Match
  `react-doctor-disable*` suppression comments that carry descriptive
  trailing text (e.g. `// react-doctor-disable-next-line rule -- why`)
  instead of requiring a bare comment. Resolves
  [#159](https://github.com/millionco/react-doctor/issues/159).

- [#198](https://github.com/millionco/react-doctor/pull/198) - Expose
  `--why` as a documented public alias for `--explain` in the CLI.
  Resolves [#161](https://github.com/millionco/react-doctor/issues/161).

- [#195](https://github.com/millionco/react-doctor/pull/195) - The
  GitHub Action's score step is output-only and never fails the job, so
  consumers can gate on the score themselves without losing the run.
  Resolves [#190](https://github.com/millionco/react-doctor/issues/190).

- [#197](https://github.com/millionco/react-doctor/pull/197) - Docs:
  clarify that `ignore.overrides` covers per-file rule ignores.

- [#199](https://github.com/millionco/react-doctor/pull/199) - Docs:
  full GitHub Actions workflow example and inputs reference.

## 0.1.4

### Patch Changes

- [`a63d5d5`](https://github.com/millionco/react-doctor/commit/a63d5d5d0bbff26e7367a0b6d634aeb089a935ef) - CLI scan output reformat. Adds `utils/wrap-indented-text.ts` for
  consistent wrapping of multi-line diagnostic recommendations, expands
  the scan-summary types to carry per-line wrap state, and threads the
  helper through `scan.ts`. Backed by the new `wrap-indented-text.test.ts`
  unit suite and a `cli-and-output` regression suite that snapshots the
  rendered CLI output.

## 0.1.3

### Patch Changes

- [#184](https://github.com/millionco/react-doctor/pull/184) - Add a
  `rawTextWrapperComponents` config option so projects can teach
  `rn-no-raw-text` about their own `<Text>` wrappers (e.g. design-system
  primitives that render `Text` internally). Resolves
  [#183](https://github.com/millionco/react-doctor/issues/183).

- [#182](https://github.com/millionco/react-doctor/pull/182) - Restore
  React Compiler rules to `error` severity. They had silently regressed
  to `warn` in 0.1.0 when the plugin-resolution gating landed, masking
  Compiler-blocking violations behind the warning lane.

- [#181](https://github.com/millionco/react-doctor/pull/181) - Website
  fix: keep the diagnostic count next to the rule name on narrow widths
  in the leaderboard / diagnostic listings.

- [`cca5808`](https://github.com/millionco/react-doctor/commit/cca5808) - Promote `react-hooks-js/*` diagnostics to errors so projects with
  React Hooks rule violations no longer pass with a clean score.

- [`9ee3a6d`](https://github.com/millionco/react-doctor/commit/9ee3a6d) - Refresh the website's terminal demo to match the new CLI output
  format introduced in 0.1.1 / 0.1.4.

## 0.1.2

### Patch Changes

- [`6ddb02c`](https://github.com/millionco/react-doctor/commit/6ddb02c6b08fbfb06e2429d3cabd338c91891cd6) - Polish follow-up to the 0.1.1 CLI redesign. Consolidates duplicated
  scan-summary literals into `constants.ts`, simplifies `scan.ts` to
  drop a redundant branch (-9 LOC), and tightens the `spinner.ts`
  helper so its cleanup is symmetric with start. No user-visible
  behaviour change.

## 0.1.1

### Patch Changes

- [#178](https://github.com/millionco/react-doctor/pull/178) - CLI
  scan-summary redesign. The final report now inlines a category
  breakdown (state-and-effects / design / bundle-size / …) and a
  compact rule list grouped under each category, replacing the
  previous single-line counts. Verbose mode keeps the per-diagnostic
  listing.

## 0.1.0

### Minor Changes

- d71a6bf: feat(react-doctor): ship rules as an ESLint plugin (`react-doctor/eslint-plugin`)

  The same React Doctor rule set that powers the CLI scan and the
  `react-doctor/oxlint-plugin` export is now available as a first-class
  ESLint plugin. Drop it into your `eslint.config.js` flat config and
  diagnostics surface inline through whichever IDE / agent / pre-commit
  hook already speaks ESLint - no separate `react-doctor` invocation
  needed.

  ```js
  // eslint.config.js
  import reactDoctor from "react-doctor/eslint-plugin";

  export default [
    reactDoctor.configs.recommended,
    reactDoctor.configs.next, // composable framework presets
    reactDoctor.configs["react-native"],
    reactDoctor.configs["tanstack-start"],
    reactDoctor.configs["tanstack-query"],
    // reactDoctor.configs.all, // every rule at react-doctor's default severity
  ];
  ```

  The exported `recommended`, `next`, `react-native`, `tanstack-start`,
  `tanstack-query`, and `all` configs reuse the exact severity maps the
  react-doctor CLI emits to oxlint, so behavior stays in lock-step
  between engines. You can also cherry-pick individual rules under the
  `react-doctor/*` namespace.

  The visitor signatures inside each rule are already ESLint-compatible
  (`create(context) => visitors`); the new export wraps each rule with
  the ESLint-required `meta` (`type`, `docs.url`, `schema`) and exposes
  the plugin shape ESLint v9 flat configs expect. Closes
  [#143](https://github.com/millionco/react-doctor/issues/143).

- d71a6bf: feat(react-doctor): adopt the project's existing oxlint / eslint config and factor those rules into the score

  When a project has a JSON-format oxlint or eslint config (`.oxlintrc.json`
  or `.eslintrc.json`) at the scanned directory or any ancestor up to the
  nearest project boundary (`.git` directory or monorepo root),
  react-doctor now folds that config into the same scan via oxlint's
  `extends` field. The user's existing rules fire alongside the curated
  react-doctor rule set, and the resulting diagnostics count toward the
  0–100 health score - no separate `oxlint` / `eslint` invocation needed.

  **Behavior change on upgrade.** Projects with an existing
  `.oxlintrc.json` / `.eslintrc.json` will see new diagnostics flow into
  the score on first run; the score may drop. Set
  `"adoptExistingLintConfig": false` in `react-doctor.config.json` (or the
  `"reactDoctor"` key in `package.json`) to preserve the previous
  behavior. `customRulesOnly: true` also implies opt-out, since that mode
  runs only the `react-doctor/*` plugin.

  **Resilience.** If oxlint can't load the user's config (broken JSON,
  missing plugin, unknown rule name), react-doctor logs the reason on
  stderr and retries the scan once without `extends` so the score is
  still computed off the curated rule set instead of failing the whole
  lint pass.

  **Coverage broadened.** Diagnostics on `.ts` and `.js` files are now
  reported (previously the parser dropped everything that wasn't `.tsx`
  / `.jsx`). This affects react-doctor's own JS-performance / bundle-size
  rules in addition to adopted user rules.

  **Limitations.** Only JSON configs are picked up: oxlint's `extends`
  cannot evaluate JS or TS, so flat configs (`eslint.config.js`),
  `.eslintrc.{js,cjs}`, and `oxlint.config.ts` are silently skipped.
  Rule-level severities (`"rules": {...}`) flow through, but
  category-level enables (`"categories": {...}`) do not - react-doctor's
  local categories block always wins. Closes #143.

- d71a6bf: feat(react-doctor): add 11 new lint rules - 3 state / correctness, 8 design system

  **3 new state / correctness rules** (all `warn`):

  - `react-doctor/no-direct-state-mutation` - flags `state.foo = x` and
    in-place array mutators (`push` / `pop` / `shift` / `unshift` /
    `splice` / `sort` / `reverse` / `fill` / `copyWithin`) on `useState`
    values. Tracks shadowed names through nested function params and
    locals so a handler that re-binds the state name doesn't
    false-positive.
  - `react-doctor/no-set-state-in-render` - flags only **unconditional**
    top-level setter calls so the canonical
    `if (prev !== prop) setPrev(prop)` derive-from-props pattern stays
    clean.
  - `react-doctor/no-uncontrolled-input` - catches `<input value={…}>`
    without `onChange` / `readOnly`, `value` + `defaultValue` conflicts,
    and `useState()` flip-from-undefined. Bails on JSX spread props
    (`{...register(…)}`, Headless UI, Radix) where `onChange` may come
    from spread.

  **8 new design-system rules in `react-ui.ts`** (all `warn`):

  - `react-doctor/design-no-bold-heading` -
    `font-bold` / `font-extrabold` / `font-black` or inline
    `fontWeight ≥ 700` on `h1`–`h6`.
  - `react-doctor/design-no-redundant-padding-axes` - collapse
    `px-N py-N` → `p-N`.
  - `react-doctor/design-no-redundant-size-axes` - collapse `w-N h-N` →
    `size-N`.
  - `react-doctor/design-no-space-on-flex-children` - use `gap-*` over
    `space-*-*`.
  - `react-doctor/design-no-em-dash-in-jsx-text` - em dashes in JSX
    text.
  - `react-doctor/design-no-three-period-ellipsis` - `Loading...` →
    `Loading…`.
  - `react-doctor/design-no-default-tailwind-palette` -
    `indigo-*` / `gray-*` / `slate-*` reads as the Tailwind template
    default; reports every offending token in the className (not just
    the first).
  - `react-doctor/design-no-vague-button-label` - `OK` / `Continue` /
    `Submit` etc.; recurses into `<>…</>` fragment children.

  Each new rule has dedicated regression tests covering both the
  positive trigger and the false-positive cases above.

  **Other**

  - Hoists shared regex / token patterns into the appropriate
    `constants.ts` per AGENTS.md.

- d71a6bf: remove(react-doctor): drop browser entrypoints, browser CLI, and the
  `react-doctor-browser` workspace package

  **Removed package exports.** `react-doctor/browser` and
  `react-doctor/worker` are no longer published. Imports of either subpath
  will fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. If you depended on the
  in-browser diagnostics pipeline (caller-supplied `projectFiles` map +
  `runOxlint` callback running oxlint in a Web Worker), pin
  `react-doctor@0.0.47` or vendor the relevant modules from the
  `archive/browser` git branch.

  **Removed CLI subcommand.** `react-doctor browser …` (`start`, `stop`,
  `status`, `snapshot`, `screenshot`, `playwright`) is gone. The
  long-running headless Chrome session, ARIA snapshot helpers, screenshot
  capture, and `--eval` Playwright harness are no longer available from
  the CLI.

  **Removed companion package.** The `react-doctor-browser` npm package
  (headless browser automation, CDP discovery, system Chrome launcher,
  cross-browser cookie extraction) has been removed from the workspace.
  The last published version remains installable on npm but will not
  receive further updates.

  **Why.** The browser surface area was unused inside the monorepo (the
  website does not import it) and added a heavy dependency footprint
  (`playwright`, `libsql`, etc.) for a public API with no known internal
  consumers. Removing it tightens what `react-doctor` is responsible for:
  the diagnostics CLI, the Node `react-doctor/api`, and the
  `react-doctor/eslint-plugin` / `react-doctor/oxlint-plugin` exports.

  The full removed source remains available on the `archive/browser`
  branch for anyone who wants to fork or vendor the modules.

### Patch Changes

- 2aebfa6: fix(react-doctor): support block comment forms of `react-doctor-disable-line` / `react-doctor-disable-next-line`

  The inline-suppression matcher previously only recognized line comments
  (`// react-doctor-disable-…`). Block comments - including the JSX form
  `{/* react-doctor-disable-next-line … */}`, which is the only suppression
  form legal directly inside JSX - were silently ignored, forcing users to
  write `{/* // react-doctor-disable-line … */}` as a workaround. Both forms
  now work, and either accepts a comma- or whitespace-separated rule list
  or no rule id (suppress every diagnostic on the targeted line). Closes #144.

- 2aebfa6: fix(react-doctor): stop flagging `useState` as `useRef` when state reaches render through `useMemo`, derived values, or context `value`

  `rerender-state-only-in-handlers` (the rule that suggests "use `useRef`
  because this state is never read in render") only checked whether the
  state name appeared by name in the component's `return` JSX. That
  heuristic produced loud false positives for ordinary patterns:

  - state filtered/derived through `useMemo` → JSX uses the memo result
  - state passed as the `value` of a React Context Provider
  - state combined with other variables into a rendered constant

  Following the bad hint and converting these to `useRef` silently broke
  apps because `ref.current = …` does not trigger a re-render - search
  results stopped updating, dialogs stayed open, and context consumers
  saw stale snapshots.

  The rule now performs a transitive "render-reachable" analysis on
  top-level component bindings. A `useState` is only flagged when neither
  the value itself nor anything derived from it (recursively) appears
  anywhere in the rendered JSX, including attribute values like
  `<Context value={…}>`, `style={…}`, `className={…}`, etc. Truly
  transient state (e.g. a scroll position only stored to be ignored)
  still fires. Closes #146.

- [#148](https://github.com/millionco/react-doctor/pull/148) ([`3f5c031`](https://github.com/millionco/react-doctor/commit/3f5c031)) - Add the (now-removed in 0.1.0) `react-doctor browser` CLI subcommand
  and 11 new lint rules: 3 state / correctness rules
  (`no-direct-state-mutation`, `no-set-state-in-render`,
  `no-uncontrolled-input`) and 8 design-system rules (see the
  dedicated bullet above).

- [#152](https://github.com/millionco/react-doctor/pull/152) ([`8f10098`](https://github.com/millionco/react-doctor/commit/8f10098)) - 4 new React 18→19 migration rules: pre-flight checks for the
  `forwardRef`-deprecation / new context API / new ref-callback
  cleanup / `use()` adoption migration paths.

- [#154](https://github.com/millionco/react-doctor/pull/154) ([`276ea2f`](https://github.com/millionco/react-doctor/commit/276ea2f)) - Add `prefer-use-sync-external-store` rule. Catches `useEffect`-based
  subscriptions that should be `useSyncExternalStore` (concurrent-mode
  safe, tearing-resistant).

- [#155](https://github.com/millionco/react-doctor/pull/155) ([`2240b1f`](https://github.com/millionco/react-doctor/commit/2240b1f)) - Add `no-event-trigger-state` rule. Flags state that is only ever
  written from an event handler and only read from the rendered JSX
  return - a frequent prop-derivation antipattern.

- [#156](https://github.com/millionco/react-doctor/pull/156) ([`4b92f50`](https://github.com/millionco/react-doctor/commit/4b92f50)) - Add `no-effect-chain` rule. Flags `useEffect` chains where one
  effect's setState triggers another effect, which is almost always a
  signal to collapse the chain into a derived value or event handler.

- [#157](https://github.com/millionco/react-doctor/pull/157) ([`0be99ad`](https://github.com/millionco/react-doctor/commit/0be99ad)) - Comprehensive useEffect analyzer: three new rules
  (`no-mutable-in-deps`, `no-mirror-prop-effect`, `effect-needs-cleanup`)
  plus shared dependency-tracking infrastructure.

- [#162](https://github.com/millionco/react-doctor/pull/162) ([`945138d`](https://github.com/millionco/react-doctor/commit/945138d)) - Gate `prefer-use-effect-event` behind React 19+ so the suggestion
  doesn't fire on React 18 projects (where `useEffectEvent` is not
  available).

- [#163](https://github.com/millionco/react-doctor/pull/163) ([`c20857e`](https://github.com/millionco/react-doctor/commit/c20857e)) - `no-effect-event-handler` honors empty-frame barriers in prop-stack
  lookups so callbacks hoisted out of effects don't inherit the
  surrounding effect classification.

- [#165](https://github.com/millionco/react-doctor/pull/165) ([`78db3b2`](https://github.com/millionco/react-doctor/commit/78db3b2)) - Multi-line JSX and stacked suppression comments, per-file rule
  overrides, and near-miss hints for misspelled rule ids.

- [#166](https://github.com/millionco/react-doctor/pull/166) ([`8745c34`](https://github.com/millionco/react-doctor/commit/8745c34)) - Suppression follow-ups: audit-mode handling, overrides-config
  validation, `--explain` working inside monorepos, JSX generics
  parsing, line-comment skip semantics, and a single-pass evaluator
  for the suppression matcher.

- [#167](https://github.com/millionco/react-doctor/pull/167) ([`d3e26d6`](https://github.com/millionco/react-doctor/commit/d3e26d6)) - Refactor: consolidate state-and-effects rule plumbing.

- [#169](https://github.com/millionco/react-doctor/pull/169) ([`50d08fd`](https://github.com/millionco/react-doctor/commit/50d08fd)) - AGENTS.md compliance pass on the state-and-effects rule directory.

- [#170](https://github.com/millionco/react-doctor/pull/170) ([`97cb1bb`](https://github.com/millionco/react-doctor/commit/97cb1bb)) - Collapse non-verbose CLI diagnostics to the top 3 rules so the
  default scan output stays scannable on large projects; `--verbose`
  restores the full listing.

- [#172](https://github.com/millionco/react-doctor/pull/172) ([`2a1b0ae`](https://github.com/millionco/react-doctor/commit/2a1b0ae)) - Tighten state-and-effects rules against false positives across the
  rules-of-hooks / handler-detection / render-reachable code paths.

- [#174](https://github.com/millionco/react-doctor/pull/174) ([`4fb4d27`](https://github.com/millionco/react-doctor/commit/4fb4d27)) - Forward `reactMajorVersion` through the programmatic `diagnose()`
  entry point so embedders get the same React-19 rule gating the CLI
  uses.

- [#177](https://github.com/millionco/react-doctor/pull/177) ([`01c38a7`](https://github.com/millionco/react-doctor/commit/01c38a7)) - Harden rules against prototype-pollution false positives and quiet
  the adopt-config noise introduced in `d71a6bf` when the user's
  config contains unknown rules.

## 0.0.47

### Patch Changes

- 6a0e6d6: chore(react-doctor): bump oxlint to ^1.62.0

  Pulls in oxlint v1.61.0 + v1.62.0 improvements (additional Vue rules,
  jest/vitest rule splits, autofix for prefer-template, no-unknown-property
  support for React 19's precedence prop, jsx-a11y/anchor-is-valid attribute
  settings, and various correctness fixes). The release-line breaking
  changes are internal Rust API only - oxlint's CLI and config schema
  are unchanged.

- dbf200d: fix(react-doctor): filter React Compiler rules to those the loaded `eslint-plugin-react-hooks` actually exports

  Follow-up to the #141 fix in 0.0.46. The peer range `^6 || ^7` allows
  v6.x of `eslint-plugin-react-hooks`, which doesn't expose the
  `void-use-memo` rule (added in v7). When a v6 user had React
  Compiler detected, oxlint failed with
  `Rule 'void-use-memo' not found in plugin 'react-hooks-js'`. The
  config now introspects the loaded plugin's `rules` map and only
  enables `react-hooks-js/*` entries that the installed version
  actually exports - so future rule additions or removals can no
  longer crash a scan.

## 0.0.46

### Patch Changes

- c13a8df: fix(react-doctor): skip React Compiler rules when `eslint-plugin-react-hooks` isn't installed

  When a project had React Compiler detected but the optional peer
  `eslint-plugin-react-hooks` was not installed, oxlint failed with
  `react-hooks-js not found` because the React Compiler rules were
  emitted into the config without the corresponding plugin entry.
  Gate `REACT_COMPILER_RULES` on successful plugin resolution so a
  missing optional peer silently skips them instead of crashing the
  scan (#141).

## 0.0.45

### Patch Changes

- 6b07924: `react-doctor install` now delegates skill installation to
  [`agent-install`](https://www.npmjs.com/package/agent-install) `0.0.4`,
  which natively models **54 supported coding agents** (up from the 8 we
  previously hand-rolled).

  Behavior changes:

  - **Detection** is now the union of CLI binaries on `$PATH` (the previous
    signal) and config dirs in `$HOME` (`~/.claude`, `~/.cursor`,
    `~/.codex`, `~/.factory`, `~/.pi`, etc.). This catches agents the user
    has run at least once even if the CLI is no longer on `$PATH`, and vice
    versa.
  - **All 8 originally documented agents stay supported**: Claude Code,
    Codex, Cursor, Factory Droid, Gemini CLI, GitHub Copilot, OpenCode, Pi.
  - **46 newly supported agents** via upstream `agent-install@0.0.4`:
    Goose, Windsurf, Roo Code, Cline, Kilo Code, Warp, Replit, OpenHands,
    Qwen Code, Continue, Aider Desk, Augment, Cortex, Devin, Junie, Kiro
    CLI, Crush, Mux, Pochi, Qoder, Trae, Zencoder, and many more.
  - **Bug fix**: malformed `SKILL.md` frontmatter now surfaces as an error
    instead of a silent "installed for ..." success with zero files
    written. Build-time validation in `vite.config.ts` also catches this
    before publish.

## 0.0.44

### Patch Changes

- [`57467cd`](https://github.com/millionco/react-doctor/commit/57467cd) - Patch follow-up to the 0.0.43 ignore-respecting refactor: misc
  rough edges in the new ignore-pattern collector and inline-disable
  matcher.

## 0.0.43

### Patch Changes

- **Respect existing eslint / oxlint / prettier ignores by default.** React Doctor now honors `.gitignore`, `.eslintignore`, `.oxlintignore`, `.prettierignore`, and `.gitattributes` `linguist-vendored` / `linguist-generated` annotations, plus inline `// eslint-disable*` and `// oxlint-disable*` comments. Previously inline disable comments were neutralized so react-doctor saw through every prior suppression - this surprised users who had `eslint-disable` in place for legitimate reasons. **Behavior change:** existing users may see fewer findings (previously-suppressed code is now correctly suppressed). To restore the old "audit everything" behavior, set `"respectInlineDisables": false` in `react-doctor.config.json` or pass `--no-respect-inline-disables` on the CLI.
- **Internals:** the ignore-pattern collector now writes a single combined `--ignore-path` file rather than passing N `--ignore-pattern` args; this removes a `baseArgs`-length pressure point that could shrink batch sizes on large diffs. Boolean config fields (`lint`, `deadCode`, `verbose`, `customRulesOnly`, `share`, `respectInlineDisables`) are now coerced from the common `"true"` / `"false"` JSON-string typo at config-load time, with a warning. The `parseOxlintOutput` "no files to lint" workaround is now locale-agnostic (it skips any noise before the first `{`). The non-git audit-mode fallback walks the project tree directly instead of silently no-op'ing when `git grep` isn't available. New regression suite covers all of the above end-to-end.

## 0.0.42

### Patch Changes

- 79fb877: Fix `Dead code detection failed (non-fatal, skipping)` (#135). The plugin-failure detector now walks the error cause chain, matches Windows-style paths, plugin configs without a leading directory, and parser errors, so knip plugin loading errors are recovered from in more environments. The retry loop also now surfaces the original knip error after exhausting attempts (previously could throw a generic `Unreachable` error) and only disables knip plugin keys it actually recognizes. Dead-code and lint failures are now reported with the full cause chain instead of a single wrapped `Error loading …` line.
- 391b751: Fix knip step ignoring workspace-local config in monorepos (#136). When a workspace owns its own knip config (`knip.json`, `knip.jsonc`, `knip.ts`, etc.), `runKnip` now runs knip with `cwd = workspaceDirectory` so the config is discovered, instead of running from the monorepo root with `--workspace` and silently falling back to knip's defaults - which mass-flagged every file as `Unused file` for setups like TanStack Start whose entry layout doesn't match the defaults. Behavior for monorepos with a root-level `knip.json` containing a `workspaces` mapping is unchanged.

## 0.0.41

### Patch Changes

- [`1fdc9a0`](https://github.com/millionco/react-doctor/commit/1fdc9a0) - Patch follow-up to the 0.0.39 browser-entrypoint work: misc
  bundling fixes for the now-removed `react-doctor/browser` and
  `react-doctor/worker` subpath exports.

## 0.0.40

### Patch Changes

- [`874f7bc`](https://github.com/millionco/react-doctor/commit/874f7bc) - Publishing-pipeline retry of 0.0.39 (no code delta).

## 0.0.39

### Patch Changes

- [#134](https://github.com/millionco/react-doctor/pull/134) ([`7da4ce4`](https://github.com/millionco/react-doctor/commit/7da4ce4)) - Fix `TypeError: issues.files is not iterable` crash during dead-code
  detection. Knip 6.x returns `issues.files` as an `IssueRecords`
  object instead of a `Set<string>`. The dead-code pass now handles
  both shapes (and arrays) defensively.

- [`5238e7b`](https://github.com/millionco/react-doctor/commit/5238e7b) / [`061a794`](https://github.com/millionco/react-doctor/commit/061a794) - Add the `react-doctor/browser` entrypoint and a `diagnoseBrowser` /
  `processBrowserDiagnostics` API so the website's in-browser
  demo can run the same scoring + rule pipeline as the CLI without
  shelling out. Shared diagnose helpers and the browser scorer are
  extracted so bundles can omit the proxy-fetch path. (The browser
  surface was later removed in 0.1.0 - see that section.)

- [`b5519b6`](https://github.com/millionco/react-doctor/commit/b5519b6) - Inject the browser scorer at build time so the bundled
  `react-doctor/browser` output omits the proxy-fetch / Node-only score
  path.

## 0.0.38

### Patch Changes

- [`8b0485a`](https://github.com/millionco/react-doctor/commit/8b0485a) - GitHub Action improvements (input validation + step output cleanups),
  clickable file paths in CLI diagnostic output (terminal hyperlinks
  via OSC-8), and a website hydration fix.

- [`bb5188f`](https://github.com/millionco/react-doctor/commit/bb5188f) - Document every config option supported by `react-doctor.config.json`
  in the README.

- [`100731c`](https://github.com/millionco/react-doctor/commit/100731c) - `install-skill` and `detect-agents` formatting fixes so CI's
  `format:check` step stays green.

## 0.0.37

### Patch Changes

- [`f1bd776`](https://github.com/millionco/react-doctor/commit/f1bd776) - Republish 0.0.36 after a botched skill payload - the
  `install-skill` SKILL.md frontmatter was malformed and the prior
  publish shipped an unusable skill. No code delta vs 0.0.36 beyond
  the SKILL.md regeneration.

## 0.0.36

### Patch Changes

- [#131](https://github.com/millionco/react-doctor/pull/131) ([`ff5b637`](https://github.com/millionco/react-doctor/commit/ff5b637)) - Frontend design-quality rules (initial cut of the design-system
  rule family - bold headings, redundant padding/size axes, vague
  button labels, etc.). Expanded substantially in 0.1.0.

- [`074f854`](https://github.com/millionco/react-doctor/commit/074f854) - Add the `react-doctor install` subcommand that installs the
  React Doctor SKILL.md into the user's configured coding agents.

## 0.0.35

### Patch Changes

- [`7136aa5`](https://github.com/millionco/react-doctor/commit/7136aa5) - Republish 0.0.34 after a packaging hiccup; no code delta.

## 0.0.34

### Patch Changes

- [#124](https://github.com/millionco/react-doctor/pull/124) ([`0eb635a`](https://github.com/millionco/react-doctor/commit/0eb635a)) - Add TanStack Start rule family (router conventions, server-function
  hygiene, `useServerFn` adoption hints).

- [#129](https://github.com/millionco/react-doctor/pull/129) ([`47105e9`](https://github.com/millionco/react-doctor/commit/47105e9)) - Fix false positives for Next.js redirect guidance and React Compiler
  detection.

## 0.0.33

### Patch Changes

- [`87d4b86`](https://github.com/millionco/react-doctor/commit/87d4b86) - Republish 0.0.32 after a packaging hiccup; no code delta.

## 0.0.32

### Patch Changes

- [#120](https://github.com/millionco/react-doctor/pull/120) ([`10bd788`](https://github.com/millionco/react-doctor/commit/10bd788)) - Address multiple GitHub issues (#117, #113, #119, #106): assorted
  rule false-positive fixes, CLI option polish, and detection
  hardening.

- [#122](https://github.com/millionco/react-doctor/pull/122) ([`901fce5`](https://github.com/millionco/react-doctor/commit/901fce5)) - Restrict setter detection to direct `Identifier` callees so dynamic
  / member-expression accessors no longer count as setter invocations.

## 0.0.31

### Patch Changes

- [#108](https://github.com/millionco/react-doctor/pull/108) ([`1aef45a`](https://github.com/millionco/react-doctor/commit/1aef45a)) - Resolve 7 GitHub issues across catalog resolution, file-ignore
  semantics, CLI ergonomics, React Native detection, Next.js
  detection, the `--offline` flag, and monorepo discovery.

- [#110](https://github.com/millionco/react-doctor/pull/110) ([`720f421`](https://github.com/millionco/react-doctor/commit/720f421)) - Apply `ignore.files` as a pre-filter so ignored files are skipped
  before linting starts (previously they were linted then filtered).

## 0.0.30

### Patch Changes

- [`c405f4a`](https://github.com/millionco/react-doctor/commit/c405f4a) - Resolve multiple GitHub issues (#71, #72, #76, #77, #83, #84, #86,
  #87, #89, #92, #93, #94): broad rule false-positive sweep across
  detection, scoring, and rule output formatting.

- [`97b21f1`](https://github.com/millionco/react-doctor/commit/97b21f1) - Replace `fs.existsSync` with the shared `isFile` utility for
  consistent file checks across the codebase.

## 0.0.29

### Patch Changes

- [#63](https://github.com/millionco/react-doctor/pull/63) ([`9f51b9d`](https://github.com/millionco/react-doctor/commit/9f51b9d)) - GitHub Action: add a `diff` input so the action can scan only files
  changed in the PR, plus optional PR-comment posting from the action
  step.

- [#64](https://github.com/millionco/react-doctor/pull/64) ([`79af7ca`](https://github.com/millionco/react-doctor/commit/79af7ca)) - Detect Expo and React Native and enable the RN-specific rule
  family when a project targets them.

- [#68](https://github.com/millionco/react-doctor/pull/68) ([`1947859`](https://github.com/millionco/react-doctor/commit/1947859)) - Rule / detection false-positive fixes (issue rollup).

## 0.0.28

### Patch Changes

- [`bd949cc`](https://github.com/millionco/react-doctor/commit/bd949cc) - Bump the Node version requirement, enhance the linting process with
  improved error handling, and tighten the CI matrix.

## 0.0.27

### Patch Changes

- [`370ea4c`](https://github.com/millionco/react-doctor/commit/370ea4c) - Refactor CLI option handling and improve automated-environment
  detection (CI / agent contexts).

- [`051a02c`](https://github.com/millionco/react-doctor/commit/051a02c) - Score-calculation refactor: extract shared constants and add the
  proxy-fetch fallback used by the in-browser scorer.

- [`bf21a87`](https://github.com/millionco/react-doctor/commit/bf21a87) - Fix `--fix` deeplink rendering issues introduced when the install
  prompt was integrated into the CLI workflow.

## 0.0.26

### Patch Changes

- [`7716d6c`](https://github.com/millionco/react-doctor/commit/7716d6c) - Integrate the SKILL.md installation prompt directly into the CLI
  workflow so first-run users get the skill installed without a
  separate command.

## 0.0.25

### Patch Changes

- [#44](https://github.com/millionco/react-doctor/pull/44) ([`dcf4276`](https://github.com/millionco/react-doctor/commit/dcf4276)) - Remove the silent global install introduced in 0.0.9; the CLI no
  longer auto-installs itself globally on first run. Resolves
  [#43](https://github.com/millionco/react-doctor/issues/43).

- [`7e20da1`](https://github.com/millionco/react-doctor/commit/7e20da1) - Refactor the diagnostic payload structure used by the
  score-estimation API and tighten its validation.

- [`da83168`](https://github.com/millionco/react-doctor/commit/da83168) - Enhance the React Doctor skill installation script with detailed
  usage instructions and support for multiple platforms.

## 0.0.24

### Patch Changes

- [#33](https://github.com/millionco/react-doctor/pull/33) ([`c2b687a`](https://github.com/millionco/react-doctor/commit/c2b687a)) - Detect React Compiler in Expo projects.

- [#37](https://github.com/millionco/react-doctor/pull/37) ([`7f49833`](https://github.com/millionco/react-doctor/commit/7f49833)) - Chore: add node.js to leaderboard.

## 0.0.23

### Patch Changes

- [`c05f4b0`](https://github.com/millionco/react-doctor/commit/c05f4b0) / [`b33976c`](https://github.com/millionco/react-doctor/commit/b33976c) - Patch sweep - assorted rule and CLI false-positive fixes.

## 0.0.22

### Patch Changes

- [`84bb6d5`](https://github.com/millionco/react-doctor/commit/84bb6d5) / [`61406e0`](https://github.com/millionco/react-doctor/commit/61406e0) / [`1b07fa2`](https://github.com/millionco/react-doctor/commit/1b07fa2) / [`0299fc4`](https://github.com/millionco/react-doctor/commit/0299fc4) - Patch sweep - rule false-positive fixes and formatting follow-ups.

## 0.0.21

### Patch Changes

- [`73da9e2`](https://github.com/millionco/react-doctor/commit/73da9e2) - Add the `--offline` flag so the CLI skips network calls (telemetry,
  the leaderboard upload step) for users behind firewalls or in
  air-gapped CI.

## 0.0.20

### Patch Changes

- [`45a3d33`](https://github.com/millionco/react-doctor/commit/45a3d33) / [`d90a60d`](https://github.com/millionco/react-doctor/commit/d90a60d) / [`b2d0b64`](https://github.com/millionco/react-doctor/commit/b2d0b64) - Surface stderr from `oxlint` / `knip` invocations so failures
  produce diagnosable error messages instead of a silent non-zero
  exit. Also updates CLI option docs.

## 0.0.19

### Patch Changes

- [`b8cc03a`](https://github.com/millionco/react-doctor/commit/b8cc03a) / [`2d2f7a1`](https://github.com/millionco/react-doctor/commit/2d2f7a1) - Update CLI options, enhance configuration documentation, and
  miscellaneous fixes.

## 0.0.18

### Patch Changes

- [#17](https://github.com/millionco/react-doctor/pull/17) ([`64d837b`](https://github.com/millionco/react-doctor/commit/64d837b)) - Add `typescript` as a direct dependency to resolve the knip peer
  requirement; previously users without TypeScript installed got a
  warning on every scan.

## 0.0.17

### Patch Changes

- [`5c2119b`](https://github.com/millionco/react-doctor/commit/5c2119b) / [`116d6cd`](https://github.com/millionco/react-doctor/commit/116d6cd) - Enhance error handling in dead-code detection so a knip failure no
  longer drops the rest of the scan output.

## 0.0.16

### Patch Changes

- [`06fb14e`](https://github.com/millionco/react-doctor/commit/06fb14e) - Improve error handling in the linting and dead-code analysis paths
  so failures log a useful message instead of a stack trace.

- [`595ca55`](https://github.com/millionco/react-doctor/commit/595ca55) - Remove the video package from `main` (kept on a separate branch for
  asset generation).

## 0.0.15

### Patch Changes

- [`e8cfef0`](https://github.com/millionco/react-doctor/commit/e8cfef0) / [`1410650`](https://github.com/millionco/react-doctor/commit/1410650) - Update `react-doctor` package configuration / constants and refresh
  the README with usage docs for the published node API.

## 0.0.14

### Patch Changes

- [`90ffa0a`](https://github.com/millionco/react-doctor/commit/90ffa0a) - Add `llms.txt` so models discovering the package via the npm
  registry can find structured docs.

- [`e218d63`](https://github.com/millionco/react-doctor/commit/e218d63) - Format the leaderboard data files to satisfy CI `format:check`.

## 0.0.13

### Patch Changes

- [#11](https://github.com/millionco/react-doctor/pull/11) ([`2d2f779`](https://github.com/millionco/react-doctor/commit/2d2f779)) - React Doctor branding refresh: theme-aware README logo + asset
  refresh. Reverted in [`28d820a`](https://github.com/millionco/react-doctor/commit/28d820a) when the assets failed to render
  correctly on npm.

- [#12](https://github.com/millionco/react-doctor/pull/12) ([`5fc130d`](https://github.com/millionco/react-doctor/commit/5fc130d)) - Fix the favicon badge ring cutout.

- [#14](https://github.com/millionco/react-doctor/pull/14) ([`67bad8f`](https://github.com/millionco/react-doctor/commit/67bad8f)) - Set the Twitter image to the brand banner.

## 0.0.12

### Patch Changes

- [`b200689`](https://github.com/millionco/react-doctor/commit/b200689) / [`4519747`](https://github.com/millionco/react-doctor/commit/4519747) / [`7f0b4d2`](https://github.com/millionco/react-doctor/commit/7f0b4d2) / [`6d1ae5e`](https://github.com/millionco/react-doctor/commit/6d1ae5e) / [`5688c1f`](https://github.com/millionco/react-doctor/commit/5688c1f) / [`6dd481a`](https://github.com/millionco/react-doctor/commit/6dd481a) / [`ce8437e`](https://github.com/millionco/react-doctor/commit/ce8437e) - Iteration sweep on detection / output formatting / README copy
  during the pre-1.0 stabilization push.

## 0.0.11

### Patch Changes

- [`db319d0`](https://github.com/millionco/react-doctor/commit/db319d0) / [`358750a`](https://github.com/millionco/react-doctor/commit/358750a) - Environment-variable handling fix: thread the documented
  `REACT_DOCTOR_*` env vars through the score-estimation API call so
  CI overrides actually take effect.

## 0.0.10

### Patch Changes

- [`e5ef934`](https://github.com/millionco/react-doctor/commit/e5ef934) - "Almost ready" milestone - the rule pipeline + scoring + CLI surface
  are end-to-end functional for the first time. No discrete commits
  between 0.0.9 and 0.0.10 beyond the version bump itself.

## 0.0.9

### Patch Changes

- [#2](https://github.com/millionco/react-doctor/pull/2) ([`1ae6094`](https://github.com/millionco/react-doctor/commit/1ae6094)) - Improve the `--prompt` clipboard output emitted for agent fixes
  (Ami-style copy block formatting).

- [#3](https://github.com/millionco/react-doctor/pull/3) ([`f664ca2`](https://github.com/millionco/react-doctor/commit/f664ca2)) - Fix the multiselect `a`-key select-all behavior in the interactive
  CLI prompt.

- [#4](https://github.com/millionco/react-doctor/pull/4) ([`940e82a`](https://github.com/millionco/react-doctor/commit/940e82a)) - Indent multi-line diagnostic help output in the CLI scan summary.

- [#5](https://github.com/millionco/react-doctor/pull/5) ([`00f21ec`](https://github.com/millionco/react-doctor/commit/00f21ec)) - Color diagnostic counts by severity in the CLI summary.

- [#6](https://github.com/millionco/react-doctor/pull/6) ([`c55edc9`](https://github.com/millionco/react-doctor/commit/c55edc9)) - Add severity icons to the summary counts.

- [#7](https://github.com/millionco/react-doctor/pull/7) ([`8894a54`](https://github.com/millionco/react-doctor/commit/8894a54)) - Frame the summary footer output (boxed border around the final
  score line).

- [#9](https://github.com/millionco/react-doctor/pull/9) ([`a66c977`](https://github.com/millionco/react-doctor/commit/a66c977)) - Move the website video overlays to a bottom-gradient layout and
  darken them.

- [`b5ea69b`](https://github.com/millionco/react-doctor/commit/b5ea69b) - Add the GitHub Action for CI integration and fix monorepo scanning
  inside CI environments.

- [`578e75a`](https://github.com/millionco/react-doctor/commit/578e75a) - Auto-install globally in the background when run via `npx`. (Later
  removed in 0.0.25 / #44 because it surprised users.)

- [`bde1167`](https://github.com/millionco/react-doctor/commit/bde1167) - Add the video package and Ami skills for marketing-asset
  generation.

## 0.0.8

### Patch Changes

- [`19fa34b`](https://github.com/millionco/react-doctor/commit/19fa34b) - Resolve a merge conflict in `cli.ts` introduced in 0.0.7.

- [`eef87e0`](https://github.com/millionco/react-doctor/commit/eef87e0) - Use a single deeplink for `--fix` instead of the two-step deeplink

  - sleep dance.

- [`9cf691d`](https://github.com/millionco/react-doctor/commit/9cf691d) / [`21c0d61`](https://github.com/millionco/react-doctor/commit/21c0d61) - Skill install prompt copy refresh and README cleanup (remove the
  rules table, promote `install` above `options`).

## 0.0.7

### Patch Changes

- [`2ae9b87`](https://github.com/millionco/react-doctor/commit/2ae9b87) - Fix the `--fix` deeplink to open the project with the correct cwd
  and autosend the prompt.

## 0.0.6

### Patch Changes

- [`f9157c7`](https://github.com/millionco/react-doctor/commit/f9157c7) - Add the `no-side-effect-in-get-handler` rule and export the oxlint
  plugin as a standalone entrypoint.

- [`9965871`](https://github.com/millionco/react-doctor/commit/9965871) / [`80d676e`](https://github.com/millionco/react-doctor/commit/80d676e) - Add the website with the animated CLI terminal landing page, and
  update the README with consumer-friendly docs.

- [`8379064`](https://github.com/millionco/react-doctor/commit/8379064) / [`de1cbd4`](https://github.com/millionco/react-doctor/commit/de1cbd4) - Add `fix` and `install-ami` commands that deeplink into Ami for
  automated rule application.

- [`330afc2`](https://github.com/millionco/react-doctor/commit/330afc2) / [`7aa7b3f`](https://github.com/millionco/react-doctor/commit/7aa7b3f) / [`05d2f79`](https://github.com/millionco/react-doctor/commit/05d2f79) / [`4dfaeab`](https://github.com/millionco/react-doctor/commit/4dfaeab) - Add ASCII doctor face / box branding to the CLI score output and
  the website terminal.

- [`b1f1abc`](https://github.com/millionco/react-doctor/commit/b1f1abc) - Add the CI workflow for e2e tests, lint, and format.

- [`4b481c8`](https://github.com/millionco/react-doctor/commit/4b481c8) - Add the React Doctor skill and the install prompt on first run.

## 0.0.5

### Patch Changes

- [`ccf404a`](https://github.com/millionco/react-doctor/commit/ccf404a) - Gracefully handle failures in `oxlint`, the reduced-motion check,
  and summary-file writing so a single subsystem can't take down the
  scan.

- [`f1407d7`](https://github.com/millionco/react-doctor/commit/f1407d7) - Gracefully handle knip failures on non-React config files.

- Project scoring (the 0–100 health score) lands in this release.

## 0.0.4

### Patch Changes

- [`2d9a69b`](https://github.com/millionco/react-doctor/commit/2d9a69b) - Add actionable help text, animation rules, per-rule summary files,
  and strengthen the framework / dependency detection.

- [`327c076`](https://github.com/millionco/react-doctor/commit/327c076) - Move the website source into `packages/website`.

## 0.0.3

### Patch Changes

- [`680e7c4`](https://github.com/millionco/react-doctor/commit/680e7c4) - Reduce default scan noisiness - tighter default rule severity
  thresholds for the first user-facing prerelease.

## 0.0.2

### Patch Changes

- [`a8770b7`](https://github.com/millionco/react-doctor/commit/a8770b7) - Add CLI scaffolding with the initial oxlint integration: scan
  command, oxlint runner, diagnostic-collection pipeline.

## 0.0.1

### Patch Changes

- [`f50426b`](https://github.com/millionco/react-doctor/commit/f50426b) - Initial publish - empty package scaffold to claim the npm name.
