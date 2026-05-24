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
    // OXC flags inline-handler-as-prop on any JSX element. We skip
    // intrinsic HTML elements (`<button>`, `<a>`, ...) because
    // neither React nor the browser memoizes DOM event listeners,
    // so a "new function per render" on intrinsic elements has zero
    // measurable cost. fail[9-12] all exercise the
    // `<button onClick={...}/>` / `<a onClick={...}/>` shape on
    // intrinsic elements.
    failSkips: [9, 10, 11, 12],
    reason: "Intentional: skip intrinsic HTML elements (no memo concern).",
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
    // Two unrelated skips merged:
    // (1) `style` / `dangerouslySetInnerHTML` (fail[5]) — these are
    //     React-mandated object-shape APIs and the perf footgun is
    //     unactionable on non-memoized components, where almost every
    //     real hit lives. See `ALWAYS_FRESH_OBJECT_PROPS` in the rule.
    // (2) configuration-shape prop names (fail[0-4, 6-8]) — `config`,
    //     `options`, `settings`, `theme`, `*Config`, `*Options`, etc.
    //     receive inline literals by design (chart / animation libs,
    //     design systems). The perf footgun the rule targets is
    //     hot-path identity changes; these are one-time setup.
    failSkips: [0, 1, 2, 3, 4, 5, 6, 7, 8],
    reason:
      "Intentional: skip `style` / `dangerouslySetInnerHTML` + configuration-shape prop names.",
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
