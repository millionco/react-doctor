# oxlint-plugin-react-doctor

## 0.5.1

### Patch Changes

- [#761](https://github.com/millionco/react-doctor/pull/761) [`77a70ab`](https://github.com/millionco/react-doctor/commit/77a70ab8a78dd21dc305a6c2b924e4bbc44058ce) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Stop flagging `only-export-components` on framework route modules ([#758](https://github.com/millionco/react-doctor/issues/758)).

  TanStack Router file routes (`export const Route = createFileRoute(...)({ component: ProfilePage })`) were reported even though the router's bundler plugin owns HMR for those modules. Route-factory exports (`createFileRoute`, `createLazyFileRoute`, `createRootRoute`, `createRootRouteWithContext`, data routers like `createBrowserRouter`, …) now count as component exports, and framework route-module contract exports (Remix / React Router `loader` / `action` / `meta` / …, Next.js Pages Router `getServerSideProps` / `getStaticProps` / …, App Router segment config, Expo Router `unstable_settings`) are allowed alongside components.

## 0.5.0

### Minor Changes

- [#756](https://github.com/millionco/react-doctor/pull/756) [`93d4eec`](https://github.com/millionco/react-doctor/commit/93d4eecdb8e9e339f4258e67fcfc3649e2024ede) Thanks [@NisargIO](https://github.com/NisargIO)! - React Doctor now runs on repositories that don't depend on React. Previously a scan hard-failed with `No React project found` / `No React dependency`, even though many checks (security, bundle size, JS performance, architecture, and the Zod rules) are framework-agnostic and apply to any TypeScript / JavaScript codebase.

  A project is now analyzable when it has source files, with or without React. A bare directory of TypeScript files — including a monorepo's `packages/` subfolder that has no `package.json` of its own — is scanned by inheriting dependency/framework detection from the enclosing workspace root.

  React-flavoured rules stay off without React. A new `react` capability (set only when React or Preact is present) gates every React-runtime rule family (hooks, JSX, accessibility, render performance, React state) plus any rule tagged `react-jsx-only`, so hook/component-name heuristics like `rules-of-hooks`, `no-legacy-class-lifecycles`, and `no-nested-component-definition` can't false-fire on ordinary TypeScript. Once React (or Preact) is detected, every rule behaves exactly as before.

### Patch Changes

- [#725](https://github.com/millionco/react-doctor/pull/725) [`b4b79ad`](https://github.com/millionco/react-doctor/commit/b4b79addce225c47048127e04be2670c13bca332) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Stop flagging the inline-`renderItem` React Native perf rules on React Compiler projects.

  React Compiler auto-memoizes inline functions and objects in list rows, so these rules were noise on compiler-enabled projects ([#723](https://github.com/millionco/react-doctor/issues/723)). `rn-no-inline-flatlist-renderitem`, `rn-list-callback-per-row`, and `rn-no-inline-object-in-list-item` now ship with `disabledBy: ["react-compiler"]`, matching the `jsx-no-new-*-as-prop` family.

- [#735](https://github.com/millionco/react-doctor/pull/735) [`af98f83`](https://github.com/millionco/react-doctor/commit/af98f83614526cca30f3a31ec2507a5df5da2bed) Thanks [@aidenybai](https://github.com/aidenybai)! - Remove the `react-doctor/jsx-no-target-blank` rule because modern browsers implicitly apply `noopener` to `target="_blank"` links.

## 0.4.2

## 0.4.1

### Patch Changes

- [#713](https://github.com/millionco/react-doctor/pull/713) [`dc35070`](https://github.com/millionco/react-doctor/commit/dc35070a5066f9864a7565b952dec2f81bff1223) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - `only-export-components` now treats Expo Router `_layout.tsx` / `_layout.jsx` files as entry points (same as Next.js `layout.tsx`), so co-located helpers alongside a single wrapped default export no longer trigger false-positive "non-component export" warnings ([#708](https://github.com/millionco/react-doctor/issues/708)).

- [#704](https://github.com/millionco/react-doctor/pull/704) [`b1a22ef`](https://github.com/millionco/react-doctor/commit/b1a22efdf7b18f2cc8b7af6c0b12173ed3c76d34) Thanks [@aidenybai](https://github.com/aidenybai)! - refactor: extract the shared `isBooleanPrefixedPropName` predicate into a single-purpose util and reuse it in `no-many-boolean-props`. Behavior-preserving.

- [#709](https://github.com/millionco/react-doctor/pull/709) [`73dcb20`](https://github.com/millionco/react-doctor/commit/73dcb2040dc6aa207beea074f846fd675c30bd2b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix `nextjs-no-img-element` false positive in Next.js metadata image routes (`opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`). These files rasterize JSX via `next/og` and cannot use `next/image`. Also fix pre-existing `alt-text` bug where backslash paths on Windows were not normalized before the same metadata-route check.

- [#710](https://github.com/millionco/react-doctor/pull/710) [`64667da`](https://github.com/millionco/react-doctor/commit/64667dae16b812ad9b4304bd7906d5ddbb50921a) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix false positive in `no-unknown-property`: the `tw` attribute (used by `@vercel/og` / `next/og` for Tailwind CSS styling) is no longer flagged in Next.js metadata image route files (`opengraph-image.tsx`, `twitter-image.tsx`, `icon.tsx`, `apple-icon.tsx`).

- [#714](https://github.com/millionco/react-doctor/pull/714) [`ee9ab33`](https://github.com/millionco/react-doctor/commit/ee9ab336d3b2918d319bc048b5b164f58611df83) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Fix false positives in `nextjs-no-use-search-params-without-suspense` and add cross-file detection. The rule now only fires on page/layout files and resolves imported components — via relative paths, tsconfig `@/` aliases, and barrel re-exports — to detect when a rendered component calls `useSearchParams()` without a `<Suspense>` boundary at the render site. A `<Suspense>` provided by an ancestor `layout.tsx`, the `<React.Suspense>` member form, and aliased `Suspense` imports are all recognized so correctly-wrapped pages aren't flagged.

- [#715](https://github.com/millionco/react-doctor/pull/715) [`fe5f3de`](https://github.com/millionco/react-doctor/commit/fe5f3de330c5c55f6bcbed68070296eb67c2ec5b) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Disable `server-fetch-without-revalidate` on Next.js 15+ projects. Next.js 15 changed the default fetch behavior from cached-forever to `no-store`, making the rule's warning obsolete. Adds Next.js version detection (workspace- and `catalog:`-aware, mirroring Expo/FlashList resolution) and the `nextjs:15` capability gate.

- [#688](https://github.com/millionco/react-doctor/pull/688) [`831cf3f`](https://github.com/millionco/react-doctor/commit/831cf3fbfd703f5048de5c2c3258e47988a2cce0) Thanks [@devin-ai-integration](https://github.com/apps/devin-ai-integration)! - Add `query-destructure-result` rule: flags `const result = useQuery(...)` where the whole TanStack Query object is assigned instead of destructured, bypassing tracked-property optimization.

## 0.4.0

## 0.3.0

### Minor Changes

- [#644](https://github.com/millionco/react-doctor/pull/644) [`eba20ae`](https://github.com/millionco/react-doctor/commit/eba20ae9a708af81c7d95dbdadf16c8e5c6d21f9) Thanks [@aidenybai](https://github.com/aidenybai)! - Demote 19 low-signal rules to opt-in (`defaultEnabled: false`) so the recommended preset focuses on correctness, performance, accessibility, and security instead of subjective style.

  - Subjective design / house-style preferences (now opt-in): `no-gradient-text`, `no-dark-mode-glow`, `no-pure-black-background`, `no-side-tab-border`, `no-wide-letter-spacing`, `no-justified-text`, `no-z-index-9999`, `design-no-em-dash-in-jsx-text`, `design-no-three-period-ellipsis`, `design-no-vague-button-label`, `design-no-redundant-padding-axes`, `design-no-redundant-size-axes`, `design-no-space-on-flex-children`.
  - Naming-convention preferences (now opt-in): `no-generic-handler-names`, `jsx-pascal-case`.
  - Legacy class-component / PropTypes rules that don't fire in a modern function-component + TypeScript codebase (now opt-in): `prefer-es6-class`, `no-default-props`, `no-prop-types`.
  - Deduplicated the array-index-key pair: `no-array-index-key` is now opt-in because it double-reported with the canonical `no-array-index-as-key` (Bugs category, friendlier message). Opt back into `no-array-index-key` only if you need its extra `React.cloneElement` coverage.

  Every rule still ships in the plugin and can be re-enabled via `severityControls` / config, so teams that adopted any of these as a deliberate house style keep them with a one-line opt-in.

### Patch Changes

- [#666](https://github.com/millionco/react-doctor/pull/666) [`5d7b36b`](https://github.com/millionco/react-doctor/commit/5d7b36bc315ba4c0a8ba6b60bd781a11efbed94f) Thanks [@aidenybai](https://github.com/aidenybai)! - Retires `rn-animate-layout-property`. Reanimated `useAnimatedStyle` runs entirely on the UI thread, so layout-affecting style animations driven by helpers like `withTiming` or `withSpring` are valid and should not be flagged.

## 0.2.18

## 0.2.17

## 0.2.16

## 0.2.15

### Patch Changes

- [#596](https://github.com/millionco/react-doctor/pull/596) [`6e59f10`](https://github.com/millionco/react-doctor/commit/6e59f10ef8b2173f0c98a653b13702d84f6471e7) Thanks [@aidenybai](https://github.com/aidenybai)! - Collapse diagnostic categories into five clear, outcome-based buckets: **Security**, **Bugs**, **Performance**, **Accessibility**, and **Maintainability**. The previous fine-grained labels (Correctness, State & Effects, React Compiler, Next.js, React Native, Server, TanStack Query/Start, Preact → Bugs; Bundle Size → Performance; Architecture/Design → Maintainability) now roll up so the scan output reads as plain issue types at a glance.

  This changes the `category` value on every diagnostic (CLI output, the per-error headline prefix like `Security: Use of eval()`, and JSON/programmatic output). If you key `categories` severity overrides off the old names, update them to the new buckets. Dead-code findings (unused files/exports/dependencies, circular imports) now report `Maintainability` instead of `Dead Code`. Bundle-size findings now sort with `Performance` (higher stakes) rather than near the bottom of the top-errors block.

- [#630](https://github.com/millionco/react-doctor/pull/630) [`75c1f99`](https://github.com/millionco/react-doctor/commit/75c1f99e062a8fc3e5e4ba294208dbc56bca5f6f) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix `react-doctor@latest` (and the ESLint/oxlint plugins) crashing before the scan starts with `ERR_MODULE_NOT_FOUND: Cannot find package 'oxc-parser'` under strict package managers like pnpm. The published `oxlint-plugin-react-doctor/dist/index.js` performs a runtime `import { parseSync } from "oxc-parser"` (cross-file parsing for rules like `no-mutating-reducer-state`) and the build intentionally keeps `oxc-parser` external, but the package only declared it under `devDependencies`, so consumers never had it installed. `oxc-parser` is now a real `dependency`. See [#629](https://github.com/millionco/react-doctor/issues/629).

## 0.2.14

## 0.2.13

## 0.2.12

### Patch Changes

- [#570](https://github.com/millionco/react-doctor/pull/570) [`d917f62`](https://github.com/millionco/react-doctor/commit/d917f62ed6215e9a984c9bfa83940bba723ff5de) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the `no-prop-types` architecture rule. React 19 removed runtime `propTypes` validation entirely — React no longer reads `Component.propTypes`, so invalid props that used to log a console warning now pass silently. The rule flags `Component.propTypes = { ... }` assignments and `static propTypes` class fields on component-cased identifiers, and is version-gated to React 19+ (`requires: ["react:19"]`) so projects where `propTypes` still runs stay quiet. It steers users toward TypeScript prop types plus explicit runtime validation. See [#460](https://github.com/millionco/react-doctor/issues/460).

- [#572](https://github.com/millionco/react-doctor/pull/572) [`d0f5206`](https://github.com/millionco/react-doctor/commit/d0f52062e09c7bfe11eda2c06ad6e9ab0ab7da58) Thanks [@aidenybai](https://github.com/aidenybai)! - Add the `react-doctor/no-self-updating-effect` rule. It warns when a `useEffect` / `useLayoutEffect` lists a state value in its dependency array and the effect body unconditionally calls that state's own `useState` setter with a value that never settles — a functional updater (`setCount((value) => value + 1)`), a freshly-constructed reference (`setItems([])`, `setUser({ ...user })`), or a value derived from the same state (`setCount(count + 1)`). Every commit re-runs the effect and re-sets the state, causing a render loop that `exhaustive-deps` does not catch because the dependency array is already complete. The rule stays quiet on mount-only `[]` effects, setters deferred inside timer/subscription/promise callbacks, guarded updates, and plausibly-stable scalar writes that settle via `Object.is` (`setOpen(true)`, `setTab(props.tab)`). See [#346](https://github.com/millionco/react-doctor/issues/346).

- [#582](https://github.com/millionco/react-doctor/pull/582) [`b2934f9`](https://github.com/millionco/react-doctor/commit/b2934f93e439027ed132e40688d45ef682f05efb) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Fix a `rn-no-raw-text` false positive on fbtee translation tags. fbtee's `<fbt>` / `<fbs>` (and namespaced children like `<fbt:param>`) are compile-time translation tags that disappear at build time, so text inside `<Text><fbt>…</fbt></Text>` is really rendered inside `<Text>` and is safe on React Native. The rule now treats `fbt` / `fbs` as transparent wrappers when every ancestor up to a text-handling component is also transparent, while still reporting raw text when an `<fbt>` is used outside a `<Text>` boundary. See [#581](https://github.com/millionco/react-doctor/issues/581).

## 0.2.11

### Patch Changes

- [#546](https://github.com/millionco/react-doctor/pull/546) [`6f8640f`](https://github.com/millionco/react-doctor/commit/6f8640f6d98a75db90d28b56fdaf5abc81a53163) Thanks [@rayhanadev](https://github.com/rayhanadev)! - Stop `js-tosorted-immutable` from firing in React Native / Expo projects. Hermes (the default RN/Expo JS engine) hasn't shipped the ES2023 change-array-by-copy methods, so the rule's recommended `array.toSorted()` rewrite of `[...array].sort()` crashed at runtime with `TypeError: undefined is not a function`. The rule now carries `disabledBy: ["react-native"]`, so it only fires on projects whose engine supports `toSorted()`.

## 0.2.10

### Patch Changes

- Add Preact support and a dedicated Preact rule family. The new checks cover pure-Preact projects importing hooks from `react`, `children.length` usage, `render()` callback arguments, `onChange` where Preact expects `onInput`, and `onDoubleClick` where Preact expects `onDblClick`.

- Add HTML and accessibility checks for invalid paragraph children, invalid table nesting, nested interactive controls, and hand-rolled modals that should use the native `<dialog>` element.

- Add `hooks-no-nan-in-deps` to catch literal `NaN` and `Number.NaN` in hook dependency arrays before they wedge React or Preact dependency tracking.

- Add Jotai diagnostics for fresh objects returned from derived atoms, `selectAtom` creation inside render, and raw TanStack Query atom usage.

- Add React Native performance rules for `renderItem` keys, missing FlashList `estimatedItemSize`, Gesture Detector press targets that should be Pressable, and `ScrollView` content-container flex usage.

- Add `js-async-reduce-without-awaited-acc` for async reducers that forget to await the accumulator.

- Add `activity-wraps-effect-heavy-subtree`, gated to React 19.2+, to flag toggleable `<Activity>` boundaries wrapping same-file components with effects that will be torn down and recreated on hide/show cycles.

- Fix false positives in `control-has-associated-label` and `no-giant-component`; the giant-component rule now verifies React render output instead of flagging large non-React TypeScript modules.

## 0.2.9

### Patch Changes

- Published with the trusted-publishing workflow update. No rule behavior changed in this package.

## 0.2.8

### Patch Changes

- add react-doctor.config.json schema field

## 0.2.7

### Patch Changes

- Add `no-mutating-reducer-state` rule that flags direct mutations of `useReducer` state (e.g. `state.items.push(...)` or `state.count++` inside a reducer body) which silently break React's immutability contract.

- Consolidate ~30 duplicated utility functions (`isFunctionLike`, `findProgramRoot`, `flattenCalleeName`, `isAstDescendant`, `hasJsxKeyAttribute`, `containsJsx`, `compileGlob`, `collectPatternNames`, `flattenJsxName`, `isAllLiteralArrayExpression`, `getCallMethodName`, etc.) into canonical shared modules under `src/plugin/utils/`, eliminating hundreds of lines of redundant code across rule files.

## 0.2.6

### Patch Changes

- Remove `design-no-bold-heading` rule - the heuristic of flagging `font-bold` on headings produced too many false positives in design systems where headings intentionally vary weight.

## 0.2.5

### Patch Changes

- Stop `jsx-key` from flagging shorthand JSX fragments (`<>...</>`) which cannot accept a `key` prop - only `React.Fragment` with explicit syntax supports keys.

- Normalize static template literal handling so rules that inspect string values treat `` `hello` `` the same as `"hello"` instead of skipping template literals with no expressions.

- Fix Node 20 runtime dependency support so the plugin resolves correctly in environments without Node 22+ built-ins.

## 0.2.4

### Patch Changes

- Adopt Effect v4 runtime throughout the core engine - tagged error classes, `Context.Service` dependency injection, and `Effect.gen` generator-based control flow replace the previous imperative error-handling approach.

- Collapse `@react-doctor/types` and `@react-doctor/project-info` into `@react-doctor/core`, simplifying the dependency graph from five workspace packages to three.

- Support user-plugin extension via `config.plugins: [...]` for custom lint rules that run alongside the built-in rule set.

- Drop deprecated `@types/eslint-scope` and `@types/eslint-visitor-keys` stubs.

- Security audit: fix four pre-existing findings (dependency pinning, permission tightening, fork guards on CI workflows).

## 0.2.3

### Patch Changes

- Fix vite build configuration for bundling workspace dependencies so the published package resolves internal imports correctly.

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

## 0.2.1

### Patch Changes

- Make filesystem walks tolerate EPERM/EACCES (macOS Library)

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

## 0.2.0-beta.6

### Minor Changes

- Add configuration-level controls for React Doctor's rule output. Users can now set top-level `rules` and `categories` severity overrides, tune individual output surfaces (`cli`, `prComment`, `score`, and `ciFailure`) by tag/category/rule id, and rely on registered rule-family tags such as `design`, `react-native`, `server-action`, `test-noise`, and `migration-hint` for broad filtering.

  The scan pipeline now applies those controls both when generating the oxlint config and when post-processing diagnostics, so `"off"` can skip rules before they run while `"warn"` / `"error"` restamp emitted diagnostics consistently across the CLI, score, PR comments, and CI failure gate. The oxlint plugin also exposes shared rule-set maps that the ESLint plugin reuses for its flat configs.

  Expose the GitHub Action's `annotations` input so workflow users can opt into inline PR annotations without dropping down to the raw CLI.

## 0.2.0-beta.5

### Patch Changes

- [#252](https://github.com/millionco/react-doctor/pull/252) [`2d90c1c`](https://github.com/millionco/react-doctor/commit/2d90c1c5ae6d901913a575d40a784058478479ec) - `no-secrets-in-client-code` is scoped to client-reachable bindings.
  The rule no longer reports on values inside `server-only` /
  `"use server"` modules, on identifiers behind a public env-var prefix
  (`NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*`, etc.), or on bindings
  classified by the new file-exposure classifier as never reaching the
  client bundle. Adds `classify-secret-file-exposure.ts`,
  `is-inside-server-only-scope.ts`, and a 561-line regression suite
  covering the removed false-positive shapes.

- [#260](https://github.com/millionco/react-doctor/pull/260) [`b53d873`](https://github.com/millionco/react-doctor/commit/b53d8730459d2dc469a8f9841def231048c8de7e) - `nextjs-no-side-effect-in-get-handler` stops flagging
  `response.headers.set(...)` and locally-constructed `Map` / `Set` /
  `Headers` inside `GET` handlers - those are the response builder,
  not a side effect. The same locally-scoped-safe-bindings classifier
  is reused by `server-auth-actions` and the TanStack Start
  `get-mutation` rule, so safe local mutations no longer trip any of
  the three. The rule still flags writes to module-scoped bindings,
  cookie stores, and external clients.

- [#265](https://github.com/millionco/react-doctor/pull/265) [`18b7033`](https://github.com/millionco/react-doctor/commit/18b7033e9e9e6f45a13c1545c8c505922bd4ab8f) - `async-defer-await` no longer reports three legitimate shapes:
  awaits inside destructured patterns with defaults
  (`const { a = await fallback() } = …`), bare
  `await expressionStatement;` that early-returns, and awaits guarded
  by an `if (…) return …` short-circuit earlier in the function. New
  helpers `collect-pattern-default-reference-names`,
  `collect-reference-identifier-names`, `contains-direct-await`,
  `is-bare-await-expression-statement`, and
  `is-early-exit-if-statement` drive the analysis, with a 409-line
  regression suite.

- [#269](https://github.com/millionco/react-doctor/pull/269) [`838c7f4`](https://github.com/millionco/react-doctor/commit/838c7f4174eaa9a7d0aea26d7e618bcc30818315) - `js-length-check-first` detects length guards anywhere earlier in an
  `&&` chain, not just as the immediate left operand. A guard like
  `obj && obj.items && obj.items.length > 0 && obj.items[0].id` no
  longer false-positives on the `[0]` access because the chain is
  flattened (`flatten-logical-and-chain`) and earlier operands are
  collected (`collect-earlier-and-guard-operands`) before the rule
  decides.

- [#270](https://github.com/millionco/react-doctor/pull/270) [`4cbf436`](https://github.com/millionco/react-doctor/commit/4cbf4368485b91f85701b3eed177282006b69fbc) - `async-parallel` is suppressed in three legitimate contexts: test
  files (`*.test.*` / `*.spec.*` / `__tests__/`, plus calls under
  `describe` / `it` / `test` / `beforeEach` / `afterEach` /
  `vi.*` / `jest.*`), browser-fixture / Playwright helpers
  (`page.*`, `browserContext.*`, `expect.*` chains), and ordered UI
  flows where serial awaits are deliberate. A new
  `is-test-library-import-source` helper recognises Vitest, Jest,
  Mocha, Playwright, and Cypress imports.

- [#272](https://github.com/millionco/react-doctor/pull/272) [`d821ca2`](https://github.com/millionco/react-doctor/commit/d821ca2a82aa5e0eae0a8de0da32123fc1b89102) - `js-combine-iterations` skips lazy `Iterator` helper chains.
  `Iterator.from(...)`, `(...).values()` /
  `(...).entries()` / `(...).keys()` followed by
  `Iterator.prototype.{map,filter,take,drop,flatMap,reduce,forEach,toArray}`
  are evaluated lazily - collapsing them into a single pass changes
  observable behaviour. The previous heuristic mis-flagged these as
  eager `Array.prototype` chains. Resolves [#205](https://github.com/millionco/react-doctor/issues/205).

- [#274](https://github.com/millionco/react-doctor/pull/274) [`3b7cc7c`](https://github.com/millionco/react-doctor/commit/3b7cc7c37336b21e4c0292dbb123b762b10a9a87) - `no-prevent-default` is framework-aware. Remix and Next.js
  progressive-enhancement form handlers (where `event.preventDefault()`
  is required to keep the client-side handler in control), synthetic
  events that have no documented alternative, and form `onSubmit`
  handlers that subsequently call `fetch` / a server action are no
  longer flagged. Backed by a 775-line regression suite covering the
  framework-specific shapes.

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

## 0.2.0-beta.4

No behavioural change in this package; published alongside the
`react-doctor` runtime-dependency fix in beta.4.

## 0.2.0-beta.3

### Patch Changes

- [#253](https://github.com/millionco/react-doctor/pull/253) [`9783acf`](https://github.com/millionco/react-doctor/commit/9783acf525a30a4aa69b20bf37b893bb39b362b0) - `no-barrel-import` resolves each `index.{ts,tsx,js,jsx,mjs,cjs}`
  module's actual export surface (`export * from …`,
  `export { x } from …`, default re-exports) and rewrites diagnostics
  to point at the relative path of the underlying file, instead of
  guessing from the import path. Direct imports of a file whose
  basename happens to be `index.ts` are no longer mis-classified as
  barrel imports. Adds `is-barrel-index-module`,
  `does-module-export-name`, `parse-export-specifiers`,
  `resolve-barrel-export-file-path`, `resolve-relative-import-path`,
  `create-relative-import-source`, and `strip-js-comments` helpers,
  with regression coverage in `tests/run-oxlint/bundle-size.test.ts`.

## 0.2.0-beta.2

### Minor Changes

- [#249](https://github.com/millionco/react-doctor/pull/249) [`f0198e2`](https://github.com/millionco/react-doctor/commit/f0198e2f2d9560a15bdb4a78f4a378ca2ac5fcdd) - **Plugin restructured into per-rule modules.** The kitchen-sink
  `src/plugin/rules/**.ts` files have been split so each rule lives in
  its own file under
  `src/plugin/rules/<category>/<rule-name>.ts`, with a generated
  `src/plugin/rule-registry.ts` wiring them together and shared
  utilities under `src/plugin/utils/**`. The plugin's published
  surface (`src/index.ts`, `rules-by-framework.ts`, `types.ts`) is
  unchanged - consumers that imported the default export continue to
  work - but rule authors writing custom shims should consult the new
  per-file layout. Companion PRs:
  [#218](https://github.com/millionco/react-doctor/pull/218) (initial
  per-file split),
  [#228](https://github.com/millionco/react-doctor/pull/228) /
  [#230](https://github.com/millionco/react-doctor/pull/230) /
  [#231](https://github.com/millionco/react-doctor/pull/231) /
  [#234](https://github.com/millionco/react-doctor/pull/234)
  (colocate severity / framework / category / requires / examples
  with each `defineRule` call),
  [#229](https://github.com/millionco/react-doctor/pull/229) (port
  inline `node.type === "X"` checks to `isNodeOfType(node, "X")`),
  [#235](https://github.com/millionco/react-doctor/pull/235) (drop
  loose `[key: string]: any` escape hatch from `EsTreeNode`),
  [#236](https://github.com/millionco/react-doctor/pull/236) (split
  `rule-maps.ts` into external-plugin-rules + react-doctor-rules),
  and [#242](https://github.com/millionco/react-doctor/pull/242)
  (auto-register rules via codegen).

### Patch Changes

- [#208](https://github.com/millionco/react-doctor/pull/208) [`8556b31`](https://github.com/millionco/react-doctor/commit/8556b31d8e4e165f791db0aa60a6b038b18ec777) - **User-feedback sweep.** Reduce false positives across the design /
  Tailwind / state-and-effects rule families, surface each rule's
  contribution to the project score, and add per-rule severity +
  rule-set selection config options. Closes the bulk of the
  feedback collected on 0.1.x.

- [#254](https://github.com/millionco/react-doctor/pull/254) [`bfaf9c9`](https://github.com/millionco/react-doctor/commit/bfaf9c9530a9f8761df6e2d69abcf44c1699ff77) - React-19-only rules
  (`prefer-use-effect-event`, the React-19 migration rule family) are
  now gated on the project's detected React major version. They stay
  silent on React 18 projects, on workspaces whose direct `react`
  dependency is `<19`, and on monorepos where the root resolution
  pins React 18 - eliminating a major source of "rule doesn't apply
  to my codebase" noise. Backed by a 343-line discover-project test
  suite and additional `parse-react-major` /
  `parse-react-peer-range` coverage.

- [#255](https://github.com/millionco/react-doctor/pull/255) [`6bc33c8`](https://github.com/millionco/react-doctor/commit/6bc33c8aab2be7c7254ce9f2a059acbcdad17a58) - `rerender-state-only-in-handlers` /
  `no-event-trigger-state` treat early-return guards
  (`if (state) return …`) as render-reachable state reads. Values
  consumed only to gate the render output no longer get reclassified
  as handler-only state, so the "use `useRef` because this state is
  never read in render" hint stops firing on guarded render paths.
  Powered by new scope-aware reference collectors
  (`scope-aware-reference-names`,
  `collect-render-reachable-expressions`,
  `collect-render-reachable-names`,
  `collect-function-like-local-names`) and an 887-line regression
  suite.

- [#256](https://github.com/millionco/react-doctor/pull/256) [`0cd9355`](https://github.com/millionco/react-doctor/commit/0cd93551a4a4600282378125d9aa237ef655835a) - `no-effect-event-handler` narrows what counts as an event handler.
  DOM imperatives (`document.classList.add/remove/toggle`,
  `el.scrollIntoView`, …), prop callbacks invoked from inside an
  effect, and side effects routed through a stable ref are no longer
  reclassified as handler-only. Adds
  `find-triggered-side-effect-callee-name` and
  `has-document-class-list-mutation` helpers and a 490-line
  regression suite.

- [#257](https://github.com/millionco/react-doctor/pull/257) [`ffbd20f`](https://github.com/millionco/react-doctor/commit/ffbd20f3d0ebda2221d2ea93f87342165da90fdb) - Locally-defined functions whose name starts with `use…` (custom
  helpers that are not React hooks) no longer trigger
  rules-of-hooks-style diagnostics. Also lands two new typography
  rules: `no-em-dash-in-jsx-text` (em / en dashes in JSX text are
  flagged with a fix that emits `--`) and
  `no-three-period-ellipsis` (now skipped inside `<pre>` / `<code>`
  ancestors via `is-inside-excluded-typography-ancestor`). Backed by
  a 445-line `rules-of-hooks-local-use` regression suite.
