// Per-rule divergences between our TypeScript ports of OXC's jsx-a11y
// rules and the upstream Rust source. Each entry lists fixture
// indices we intentionally skip from the OXC `pass`/`fail` vec along
// with WHY.
//
// Most divergences here cite "narrower-than-OXC port" because the
// upstream rules call into deep semantic helpers (full ARIA spec
// validation, role inheritance graph, polymorphic-prop scope
// resolution) that we don't replicate verbatim.

export interface OxcDivergence {
  passSkips?: ReadonlyArray<number>;
  failSkips?: ReadonlyArray<number>;
  reason: string;
}

export const DIVERGENCES: Record<string, OxcDivergence> = {
  // alt-text: OXC's port has extensive aria-hidden / role / fallback
  // child-content checks. Our port handles the common img / area /
  // input[type=image] / object shapes only.
  // no-autofocus: OXC's `ignoreNonDOM` defaults to false, which means
  // `<Foo autoFocus />` (a custom component) is flagged. Our port
  // defaults `ignoreNonDOM` to TRUE — matching jsx-a11y's multi-year
  // default — because flagging the consumer of a focus-aware
  // wrapper-component is noise: the component decides if/when/how
  // `.focus()` is called on the actual DOM element. The internal
  // `<input autoFocus>` inside the wrapper still gets flagged.
  "no-autofocus": {
    failSkips: [9],
    reason:
      "ignoreNonDOM defaults to true (jsx-a11y convention); `<Foo autoFocus />` is the consumer site, not the focus-call site.",
  },
  // no-redundant-roles: `<ol role="list">` (failCases[21]) and
  // `<ul role="list">` (failCases[22]) are the deliberate Safari/VoiceOver
  // list-semantics workaround (`list-style: none` drops list semantics in
  // WebKit), so we exempt them by default — an intentional a11y idiom, not
  // redundant noise.
  "no-redundant-roles": {
    failSkips: [21, 22],
    reason:
      '`<ul|ol role="list">` is the Safari/VoiceOver list-semantics-preservation idiom, exempt by default.',
  },
  // role-has-required-aria-props: `<input type='checkbox' role='switch' />`
  // (failCases[14]) is the recommended native switch pattern — the input's
  // native checkedness maps to `aria-checked` intrinsically (even
  // uncontrolled), and ARIA in HTML forbids authoring `aria-checked` on it.
  "role-has-required-aria-props": {
    failSkips: [14],
    reason:
      "A native `<input type='checkbox' role='switch'>` supplies `aria-checked` from its DOM checked state; requiring the explicit prop is a false positive.",
  },
};
