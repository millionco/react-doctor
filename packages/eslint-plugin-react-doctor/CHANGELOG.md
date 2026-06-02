# eslint-plugin-react-doctor

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

- [#570](https://github.com/millionco/react-doctor/pull/570) [`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the `no-prop-types` architecture rule. React 19 removed runtime `propTypes` validation entirely — React no longer reads `Component.propTypes`, so invalid props that used to log a console warning now pass silently. The rule flags `Component.propTypes = { ... }` assignments and `static propTypes` class fields on component-cased identifiers, and is version-gated to React 19+ (`requires: ["react:19"]`) so projects where `propTypes` still runs stay quiet. It steers users toward TypeScript prop types plus explicit runtime validation. See [#460](https://github.com/millionco/react-doctor/issues/460).

- [#582](https://github.com/millionco/react-doctor/pull/582) [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a `rn-no-raw-text` false positive on fbtee translation tags. fbtee's `<fbt>` / `<fbs>` (and namespaced children like `<fbt:param>`) are compile-time translation tags that disappear at build time, so text inside `<Text><fbt>…</fbt></Text>` is really rendered inside `<Text>` and is safe on React Native. The rule now treats `fbt` / `fbs` as transparent wrappers when every ancestor up to a text-handling component is also transparent, while still reporting raw text when an `<fbt>` is used outside a `<Text>` boundary. See [#581](https://github.com/millionco/react-doctor/issues/581).

- Updated dependencies [[`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de), [`d0f5206`](https://github.com/millionco/react-doctor/commit/d0f52062e09c7bfe11eda2c06ad6e9ab0ab7da58), [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb)]:
  - oxlint-plugin-react-doctor@0.2.12

## 0.2.11

### Patch Changes

- Updated dependencies [[`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163)]:
  - oxlint-plugin-react-doctor@0.2.11

## 0.2.10

### Patch Changes

- Inherit the latest shared rule registry from `oxlint-plugin-react-doctor@0.2.10`: Preact compatibility checks, HTML correctness and dialog accessibility rules, `hooks-no-nan-in-deps`, Jotai atom diagnostics, React Native performance rules, `js-async-reduce-without-awaited-acc`, and React 19.2 `<Activity>` effect-boundary checks.

- Inherit false-positive fixes for `control-has-associated-label` and `no-giant-component`.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.10`.

## 0.2.9

### Patch Changes

- Published with the trusted-publishing workflow update. No ESLint rule behavior changed in this package.

- Dependency bump: `oxlint-plugin-react-doctor@0.2.9`.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.8

## 0.2.7

### Patch Changes

- Bundle `eslint-plugin-react-hooks` as a direct dependency so React Compiler rules resolve without requiring users to install the peer separately.

- Inherit the `no-mutating-reducer-state` rule and helper consolidation from `oxlint-plugin-react-doctor@0.2.7`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.7

## 0.2.6

### Patch Changes

- Inherit the `design-no-bold-heading` rule removal from `oxlint-plugin-react-doctor@0.2.6`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.6

## 0.2.5

### Patch Changes

- Inherit the `jsx-key` shorthand fragment fix, static template literal normalization, and Node 20 support from `oxlint-plugin-react-doctor@0.2.5`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.5

## 0.2.4

### Patch Changes

- Inherit the Effect v4 runtime adoption, deprecated type stub removal, and user-plugin extension support from `oxlint-plugin-react-doctor@0.2.4`.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.4

## 0.2.3

### Patch Changes

- Fix build configuration so the ESLint plugin resolves its dependency on `oxlint-plugin-react-doctor` correctly at publish time.

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

## 0.2.0-beta.6

### Minor Changes

- Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

### Patch Changes

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.6

## 0.2.0-beta.5

### Patch Changes

- Inherits the rule-fix wave from
  `oxlint-plugin-react-doctor@0.2.0-beta.5` via the shared rule
  registry: `no-secrets-in-client-code` scoping
  ([#252](https://github.com/millionco/react-doctor/pull/252)),
  `nextjs-no-side-effect-in-get-handler` safe local bindings
  ([#260](https://github.com/millionco/react-doctor/pull/260)),
  `async-defer-await` destructuring / bare-statement / early-return
  fixes ([#265](https://github.com/millionco/react-doctor/pull/265)),
  `js-length-check-first` `&&`-chain detection
  ([#269](https://github.com/millionco/react-doctor/pull/269)),
  `async-parallel` test / browser-fixture suppression
  ([#270](https://github.com/millionco/react-doctor/pull/270)),
  `js-combine-iterations` lazy `Iterator` skip
  ([#272](https://github.com/millionco/react-doctor/pull/272)), and
  `no-prevent-default` framework awareness
  ([#274](https://github.com/millionco/react-doctor/pull/274)). See
  the oxlint plugin changelog for per-rule detail.

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

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.4

## 0.2.0-beta.3

### Patch Changes

- Inherits the `no-barrel-import` index-resolution fix from
  [#253](https://github.com/millionco/react-doctor/pull/253) via the
  shared rule registry. See the oxlint plugin changelog.

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.3

## 0.2.0-beta.2

### Minor Changes

- Inherits the per-rule module restructuring from
  `oxlint-plugin-react-doctor@0.2.0-beta.2`
  ([#249](https://github.com/millionco/react-doctor/pull/249) and
  follow-ups). The published ESLint plugin shape (flat-config-ready
  `recommended` / framework presets, `react-doctor/*` rule namespace)
  is unchanged - the bump is minor because rule authors writing
  custom shims now consume per-file modules instead of the previous
  kitchen-sink files.

### Patch Changes

- Inherits the beta.2 false-positive sweep from
  `oxlint-plugin-react-doctor@0.2.0-beta.2`:
  user-feedback rule tuning + scoring transparency
  ([#208](https://github.com/millionco/react-doctor/pull/208)),
  React-19 rule version-gating
  ([#254](https://github.com/millionco/react-doctor/pull/254)),
  render-reachable state analysis
  ([#255](https://github.com/millionco/react-doctor/pull/255)),
  narrowed `no-effect-event-handler` detection
  ([#256](https://github.com/millionco/react-doctor/pull/256)), and
  local `useX` helper suppression + new typography rules
  ([#257](https://github.com/millionco/react-doctor/pull/257)).

- Updated dependencies []:
  - oxlint-plugin-react-doctor@0.2.0-beta.2
