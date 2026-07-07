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
  // aria-role: OXC's `ignoreNonDOM` defaults to false, flagging `role`
  // props on custom components. Our port defaults it to TRUE: in the
  // verify corpus every custom-component hit was a domain prop (chat
  // role, member role, hook option) or a deliberate `role={undefined}`
  // MUI override — never a real ARIA surface. A forwarded role is still
  // checked at the DOM element inside the component.
  "aria-role": {
    failSkips: [11, 12, 15],
    reason:
      "ignoreNonDOM defaults to true; `role` on a custom component is a domain prop, not the DOM ARIA attribute.",
  },
  // control-has-associated-label: OXC inherits jsx-a11y's DOM map and
  // treats td/th/option as interactive elements and any role=separator
  // as a widget. Real-world verification shows these fire almost
  // exclusively on skeleton/spacer table cells, value-only datalist
  // options, and decorative non-focusable dividers — none of which is
  // an operable control needing a label. Elements that opt into a real
  // widget role (`<td role="button">`) or a focusable separator
  // (`tabIndex`) are still flagged.
  "control-has-associated-label": {
    failSkips: [10, 11, 12, 27],
    reason:
      '`<option/>`, `<th/>`, `<td/>`, and non-focusable `role="separator"` are not operable controls; flagging them is noise on skeleton cells, datalist options, and dividers.',
  },
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
  // no-static-element-interactions: keyboard handlers on a div that has
  // no tabIndex/contentEditable and no pointer handler only fire for
  // events BUBBLING from focusable descendants — the composite-widget /
  // Escape-shortcut delegation pattern (confirmed benign at scale in the
  // verify run), not an undiscoverable control.
  "no-static-element-interactions": {
    failSkips: [8, 64, 65],
    reason:
      "Keyboard-only handlers on a non-focusable element are bubbled-event delegation, not a control needing a role.",
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
