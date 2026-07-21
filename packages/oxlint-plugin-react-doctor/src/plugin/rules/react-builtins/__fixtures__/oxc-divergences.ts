// Documents per-rule divergences between our TypeScript ports and the
// OXC Rust source. Each entry lists fixture indices we intentionally
// skip from the OXC `pass`/`fail` vec along with WHY — usually because
// the upstream rule depends on capabilities our visitor-only plugin
// doesn't have (scope analysis, control-flow graph) and a partial port
// would silently miss the relevant cases.
//
// Keep this list short. New rules should ship without entries here;
// add only after a careful look at the OXC rule to confirm the gap is
// fundamental, not just a missed test case.

export interface OxcDivergence {
  passSkips?: ReadonlyArray<number>;
  failSkips?: ReadonlyArray<number>;
  reason: string;
}

export const DIVERGENCES: Record<string, OxcDivergence> = {
  "jsx-no-target-blank": {
    failSkips: [31],
    reason:
      "Intentional: a later authoritative non-blank target overrides an earlier unknown spread.",
  },
  "exhaustive-deps": {
    failSkips: [81, 125, 126, 127],
    reason:
      "Intentional: exact props members suppress a synthetic whole-props dependency, unknown or deferred state values can converge through React's same-value bailout, and useMemo accepts extra reactive invalidation tokens.",
  },
  "no-unknown-property": {
    // fp-review: 1110 unique false positives vs 28 true positives (1%
    // precision) drove three narrowings, each encoded by a fixture:
    // (1) fail[2] (`<div abc="…"/>`) — since React 16, unknown
    //     all-lowercase attributes are rendered to the DOM verbatim
    //     (Electron `<webview partition>`, `<iframe credentialless>`,
    //     library hooks like `frimousse-list`), so "React ignores this
    //     prop" is false. Only names with a known camel form, uppercase
    //     chars, or malformed `aria-*`/`data-*` still report.
    // (2) fail[19-20] (`<div onLoad/>`, `<div onAbort … onError/>`) —
    //     React attaches synthetic events to any host element; the
    //     per-tag whitelist only applies to non-event attributes.
    // (3) fail[38] (`<t onChñnge/>`) — lowercase intrinsics that aren't
    //     real HTML/SVG tags (react-three-fiber `<mesh>`, `<webview>`)
    //     are custom-reconciler elements, not DOM elements, and are
    //     skipped entirely.
    // (4) fail[14] (`<rect clip-path="bar"/>`) — docs-validation
    //     2026-07: hyphenated SVG presentation attributes on SVG
    //     elements are the real attribute names and render verbatim;
    //     renaming to camelCase is purely stylistic.
    failSkips: [2, 14, 19, 20, 38],
    reason:
      "Intentional: skip verbatim-rendered lowercase attrs, hyphenated SVG attrs on SVG hosts, tag-restricted event handlers, and non-HTML/SVG lowercase intrinsics (R3F-style FPs).",
  },
  "no-find-dom-node": {
    // OXC flags a bare `findDOMNode(...)` purely by name. A locally
    // defined `function findDOMNode(...)` (or any same-name helper) is
    // a common false positive, so React Doctor only fires the bare form
    // when the binding was imported from `react-dom`. fail[3] and
    // fail[4] call bare `findDOMNode(this)` without importing it, so
    // they no longer match. The `<NS>.findDOMNode` member forms
    // (fail[0-2]) and the imported bare form still fire — see
    // `no-find-dom-node.regressions.test.ts`.
    failSkips: [3, 4],
    reason: "Intentional: bare findDOMNode must be imported from react-dom (locals are FPs).",
  },
  "forbid-component-props": {
    // OXC applies a default forbid list `["className", "style"]` when the
    // rule is enabled without options, flagging the canonical Tailwind /
    // shadcn customization pattern on every component usage (prod
    // telemetry: avg 639 firings per affected run). React Doctor keeps
    // the rule inert until the project names the props to block, so
    // fail[0] (`<Foo className/>`) and fail[1] (`<Foo style/>`), which
    // pass no options, no longer report. Every configured fixture still
    // fires — see `forbid-component-props.regressions.test.ts`.
    failSkips: [0, 1],
    reason: "Intentional: no implicit className/style default — explicit `forbid` config required.",
  },
  "no-this-in-sfc": {
    // OXC decides "is an SFC" from the PascalCase name alone, so a plain
    // ES5 constructor (`function Stack() { this.items = []; }`) or a
    // PascalCase factory eats a false positive. React Doctor additionally
    // requires the function to actually render (JSX / createElement) via
    // `functionContainsReactRenderOutput`. fail[6] (`function Foo(props) {
    // if (this.props.foo) {…} return null; }`) reads `this.props` but
    // returns null and never renders, so the render gate no longer fires
    // on it — an accepted false-negative on a rare shape in exchange for
    // killing the common constructor-function FP. Every JSX-returning
    // fail fixture still fires; see `no-this-in-sfc.regressions.test.ts`.
    failSkips: [6],
    reason: "Intentional: require real render output (kills constructor-function FPs).",
  },
  // (Merged into the comprehensive `jsx-no-new-object-as-prop`
  // entry below, which combines the `style` / `dangerouslySetInnerHTML`
  // skip with the config-shape prop-name skip.)
  "jsx-max-depth": {
    // OXC's default `max: 2` flags JSX trees that depth past 2 levels,
    // which is far too strict for real React UIs (any shadcn Card
    // exceeds it). We default `max: 10` instead and the fail[6]
    // fixture (`<div>{<div><div><span/></div></div>}</div>`, depth 4)
    // no longer exceeds the threshold.
    failSkips: [6],
    reason: "Intentional: default max raised from 2 → 10 to suppress idiomatic-React FPs.",
  },
  "only-export-components": {
    // Three intentional divergences:
    // (1) fail[3, 4, 10, 14] — OXC defaults `allowConstantExport: false`,
    //     which flags any primitive-constant export alongside a
    //     component. We default `allowConstantExport: true` because
    //     exported constants are stable references that don't break Fast
    //     Refresh — matches the recommended config in
    //     `eslint-plugin-react-refresh`.
    // (2) fail[6] — a pure `export *` barrel is not instrumented as a
    //     Fast Refresh boundary by Vite's official React plugin. It only
    //     reports when the same module also declares a local component.
    // (3) fail[12, 13, 21] — non-exported internal components are no
    //     longer reported. The react-refresh boundary constraint is
    //     about exports only (a module that exports a component must
    //     export only components); a module whose exports carry no
    //     component was never a refresh boundary, and "export this
    //     component" is the wrong advice for config/registry files that
    //     merely USE a local component (`export const tabs = [<Tab/>]`).
    //     The real breaker — a namespace-object export bundling
    //     components — is reported instead (not covered by OXC fixtures;
    //     see only-export-components.regressions.test.ts).
    // (4) Function exports require JSX/createElement return evidence.
    //     OXC treats every PascalCase function as a component, which
    //     misclassifies acronym-named formatters in utility modules.
    passSkips: [14, 15, 16, 17, 18, 42, 51, 52, 53, 54, 56, 57, 61, 62],
    failSkips: [0, 1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 18, 19, 21, 22, 23],
    reason:
      "Intentional: require render-output proof for inspectable functions; recognize Babel Fast Refresh wrapper transforms; default allowConstantExport=true; pure export-star barrels are not refresh boundaries; exports-only Fast-Refresh model (local components unreported, namespace-object exports flagged).",
  },
  "jsx-pascal-case": {
    // OXC defaults `allowLeadingUnderscore: false`. We default to
    // `true` because Radix UI / Headless UI / React Aria consumers
    // routinely import components as `_ContextMenu`, `_DialogPrimitive`
    // etc. fail[3] (`<_TEST_COMPONENT />` with `allowAllCaps: true`)
    // is the only fixture where the underscore-strip changes the
    // verdict — with leading underscore allowed, the stripped name
    // `TEST_COMPONENT` passes the all-caps check.
    failSkips: [3],
    reason: "Intentional: default allowLeadingUnderscore=true for Radix-style wrappers.",
  },
  "jsx-key": {
    // Two intentional divergences:
    // (1) Shorthand fragments (fail[14-15]) — OXC can report `<>...</>` in
    //     arrays / iterators via `checkFragmentShorthand`. React Doctor never
    //     does: a shorthand fragment cannot carry a key, and the actionable
    //     fix is rewriting syntax rather than adding the missing prop.
    // (2) key-after-spread (fail[16-17, 23]) — OXC's `checkKeyMustBeforeSpread`
    //     flags `<App {...obj} key="x" />`, but a spread can only clobber an
    //     explicit `key` when it sits AFTER the key (later attribute wins
    //     under both the classic and automatic JSX runtimes). A key written
    //     after every spread always survives, so flagging it is a false
    //     positive. We instead report the real override risk — a spread after
    //     the key — which OXC's fixtures don't cover.
    failSkips: [14, 15, 16, 17, 23],
    reason:
      "Intentional: never report shorthand fragments; flag key-before-spread (the real override risk), not key-after-spread.",
  },
  "no-unstable-nested-components": {
    // OXC defaults `allowAsProps: false`, which flags render-prop
    // components passed as JSX props. We default to `true` because
    // render-prop / component-as-prop is the canonical React
    // composition pattern (`<Trans bold={(el) => <b>{el}</b>}/>`,
    // tldraw's `components={{HelperButtons: () => ...}}`, twenty's
    // `<Button Icon={() => <Loader/>}/>` etc.). These 12 fixtures
    // all exercise the render-prop-as-component path and now pass.
    failSkips: [20, 21, 22, 23, 26, 27, 28, 30, 31, 32, 40, 41],
    reason: "Intentional: default allowAsProps=true to allow render-prop components.",
  },
  "jsx-no-new-function-as-prop": {
    // Two intentional skips:
    // (1) intrinsic HTML elements (fail[9-12]) — `<button onClick={...}/>`
    //     / `<a onClick={...}/>`: neither React nor the browser memoizes
    //     DOM event listeners, so a "new function per render" on intrinsic
    //     elements has zero measurable cost.
    // (2) non-memoised consumers (fail[0-8]) — OXC flags an inline handler
    //     on ANY consumer. We only fire when same-file analysis PROVES the
    //     consumer is `memo`-wrapped, because a fresh function reference
    //     only breaks a memoized child (see `memoStatusForJsxOpeningName`).
    //     OXC's fixtures pass plain/unknown consumers, so our gate
    //     suppresses them. The gated (memoised-consumer) path is covered by
    //     `jsx-no-new-function-as-prop.regressions.test.ts`.
    failSkips: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    reason: "Intentional: skip intrinsic HTML elements + non-memoised consumers (memo-gated rule).",
  },
  "jsx-no-jsx-as-prop": {
    // Two skips merged:
    // (1) known slot-prop names (fail[4], `<IconButton icon={Icon}/>`) —
    //     `icon`, `tooltip`, `header`, `fallback`, `render*`, etc. are
    //     designed to receive single JSX elements; every design system
    //     (shadcn, Radix, MUI, Mantine, Chakra) has them and the
    //     inline-JSX form is the canonical usage.
    // (2) non-memoised consumers (fail[0-3]) — like the other
    //     react_perf ports, we only fire when same-file analysis PROVES
    //     the consumer is `memo`-wrapped. OXC's fixtures pass
    //     plain/unknown consumers (`<Item jsx={<SubItem/>}/>`), so the
    //     memo gate suppresses them. Prod telemetry review 2026-07:
    //     40/40 corpus hits were slots on memo-unknown imported
    //     components. The gated path is covered by
    //     `jsx-no-jsx-as-prop.regressions.test.ts`.
    failSkips: [0, 1, 2, 3, 4],
    reason: "Intentional: skip slot-prop names + non-memoised consumers (memo-gated rule).",
  },
  "jsx-no-new-object-as-prop": {
    // Three skips merged:
    // (1) `style` / `dangerouslySetInnerHTML` (fail[5]) — these are
    //     React-mandated object-shape APIs and the perf footgun is
    //     unactionable on non-memoized components, where almost every
    //     real hit lives. See `ALWAYS_FRESH_OBJECT_PROPS` in the rule.
    // (2) configuration-shape prop names (fail[0-4, 6-8]) — `config`,
    //     `options`, `settings`, `theme`, `*Config`, `*Options`, etc.
    //     receive inline literals by design (chart / animation libs,
    //     design systems). The perf footgun the rule targets is
    //     hot-path identity changes; these are one-time setup.
    // (3) non-memoised consumers (fail[9-14]) — like
    //     `jsx-no-new-function-as-prop`, we only fire when same-file
    //     analysis proves the consumer is `memo`-wrapped. OXC's
    //     render-local-binding fixtures (`const x = {}; <Bar x={x}/>`)
    //     pass plain consumers, so the memo gate suppresses them. The
    //     gated path is covered by
    //     `jsx-no-new-object-as-prop.regressions.test.ts`.
    failSkips: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],
    reason:
      "Intentional: skip `style` / `dangerouslySetInnerHTML` + config-shape props + non-memoised consumers.",
  },
  "jsx-no-new-array-as-prop": {
    // OXC's fixtures use `<Item list={[...]}/>` to test inline-array
    // detection. We skip data-collection prop names (`list`, `items`,
    // `data`, `options`, `*Items`, `*Options`, etc.) because list /
    // table / menu / chart components all take inline arrays by
    // convention. fail[0-10] all exercise the `list` prop pattern.
    failSkips: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    reason: "Intentional: skip data-collection prop names (list, items, options, data, etc.).",
  },
  "no-multi-comp": {
    // OXC flags a file with 2+ components. React Doctor intentionally
    // only flags 3+: a "1 main + 1 sub-component" file (e.g.
    // `ErrorBoundary` + `OptionalErrorBoundary`) is idiomatic
    // co-location, not a smell — see the `flagged.length <= 2` guard in
    // the rule, plus the barrel / feature-module exemptions. Every OXC
    // fail fixture here declares exactly 2 components, so all 20 fall
    // below our threshold. The 3+ behaviour and the exemptions are
    // covered by `no-multi-comp.regressions.test.ts`.
    failSkips: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
    reason:
      "Intentional: flag only 3+ components (OXC flags 2+); idiomatic 2-component co-location is allowed.",
  },
  "no-array-index-key": {
    // OXC's rule covers both the JSX `key={index}` attribute and the
    // `React.cloneElement(child, { key: index })` shape. React Doctor's
    // canonical index-key rule is `no-array-index-as-key` (Bugs
    // category, default-on, richer exemptions), which owns the JSX
    // attribute path — keeping a second JSX path in this opt-in port
    // double-reported every hit when both rules were enabled (prod
    // telemetry 2026-07). This port is therefore scoped to the
    // cloneElement coverage the canonical rule doesn't have, so every
    // JSX-attribute fail fixture (fail[0-3, 8-18]) is delegated. The
    // cloneElement fixtures (fail[4-7, 19-20]) still fire — see
    // `no-array-index-key.regressions.test.ts`.
    failSkips: [0, 1, 2, 3, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    reason:
      "Intentional: JSX `key={index}` is owned by no-array-index-as-key; this port only covers React.cloneElement.",
  },
  "style-prop-object": {
    // OXC flags `style="..."` on any JSX element. We only flag it on
    // intrinsic HTML/SVG elements because custom components own their
    // `style` prop contract — Expo's `<StatusBar style="auto"/>`,
    // React Native chart libs, and many design systems accept strings
    // or enums. The fixtures fail[1], fail[5], fail[7] all exercise
    // `<Hello style="..."/>` / `<MyComponent style={...}/>` shapes.
    failSkips: [1, 5, 7],
    reason: "Intentional: skip custom components (they own their style-prop contract).",
  },
};
