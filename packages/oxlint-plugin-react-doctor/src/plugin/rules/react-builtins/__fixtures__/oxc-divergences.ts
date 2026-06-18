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
    // OXC defaults `allowConstantExport: false`, which flags any
    // primitive-constant export alongside a component. We default
    // `allowConstantExport: true` because exported constants are
    // stable references that don't break Fast Refresh — matches the
    // recommended config in `eslint-plugin-react-refresh`.
    failSkips: [3, 4, 10, 14],
    reason: "Intentional: default allowConstantExport=true to suppress shadcn-style FPs.",
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
    // OXC can be configured to report shorthand fragments (`<>...</>`)
    // in arrays / iterators via `checkFragmentShorthand`. React Doctor
    // intentionally never reports shorthand fragments here: a shorthand
    // fragment cannot carry a key, and the actionable fix would be
    // rewriting syntax rather than adding the missing prop the rule is
    // meant to guide. fail[14-15] are the explicit fragment-option
    // fixtures.
    failSkips: [14, 15],
    reason: "Intentional: never report shorthand fragments from jsx-key.",
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
    // OXC flags any JSX passed as a prop. We skip well-known "slot"
    // prop names (`icon`, `tooltip`, `header`, `fallback`, `render*`,
    // etc.) because these props are designed to receive single JSX
    // elements — every design system (shadcn, Radix, MUI, Mantine,
    // Chakra) has them, and the inline-JSX form is the canonical
    // usage. fail[4] (`<IconButton icon={Icon}/>`) exercises the
    // `icon` slot.
    failSkips: [4],
    reason: "Intentional: skip known slot-prop names (icon, tooltip, fallback, render*, etc.).",
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
    // OXC flags any key expression that incorporates the array index,
    // including arithmetic. React Doctor's composite-key heuristic
    // deliberately skips `<expr> + index` shapes because an offset is
    // often a stable global scheme (`key={page * pageSize + index}`,
    // which produces a unique-across-pages key). fail[2] (`key={1 +
    // index}`) is the degenerate constant-offset case that the same
    // heuristic also skips — a minor accepted false-negative on a
    // default-OFF rule. The direct `key={index}` cases (fail[0-1,
    // 3-20]) still fire.
    failSkips: [2],
    reason:
      "Intentional: composite-key heuristic skips `<expr> + index`, incl. the constant `1 + index`.",
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
