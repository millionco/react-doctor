---
"oxlint-plugin-react-doctor": patch
---

fix(architecture): eliminate false positives across architecture, correctness, and design rules

Hardens ~15 rules so they stop firing on valid code, without weakening the real smell each targets.

Architecture:

- `no-many-boolean-props` requires actual render output before treating a parameter as component props (so non-component factories like `CreateValidator(options)` are skipped), and no longer counts props that are invoked or wired as event handlers (`onClick={showMenu}`) as boolean flags.
- `no-nested-component-definition` only flags a nested definition that is actually rendered as JSX (`<Inner/>`) inside its own enclosing component, not a capitalized helper that is merely called (`Inner()`) — and no longer leaks a sibling component's `<Inner/>` onto a same-named call-only helper.
- `no-render-in-render` exempts render-prop invocations (`props.renderX()`, `this.props.renderX()`, `props.slots.renderX()` on a nested prop bag, and render props destructured from props or a component parameter) and stable class-method calls (`this.renderX()`), while still flagging a `render*` parameter of an ordinary nested helper.
- `no-render-prop-children` ignores `render*Props` config bags and literal `render*` mode/flag values, which are not render slots.
- `prefer-module-scope-static-value` no longer hoists initializers that call impure globals (`Date.now()`, `Math.random()`, `crypto.randomUUID()`, `nanoid()`, …), which are meant to recompute per render.
- `react-compiler-destructure-method` drops `useSearchParams` (its methods are unbound and throw when destructured).
- `react-compiler-no-manual-memoization` leaves `memo(Component, areEqual)` with a custom comparator alone.

Correctness:

- `html-no-invalid-paragraph-child` and `html-no-nested-interactive` stop at JSX attribute boundaries, so an element passed as a prop is no longer treated as a DOM child / nested element.
- `no-polymorphic-children` only flags `typeof children` when `children` resolves to the component's props, not a local variable or field that happens to be named `children`.
- `no-prevent-default` skips `<form action=…>` (which has a native no-JS submit path) and anchors whose handler also navigates or side-effects after `preventDefault()`.
- `no-uncontrolled-input` treats `onInput` as controlling like `onChange`, and no longer flags `disabled` inputs (React suppresses its missing-`onChange` warning for `disabled` fields, just like `readOnly`).
- `rendering-svg-precision` requires at least two distinct over-precise coordinates before reporting.

Design:

- `no-gray-on-colored-background` only fires when the gray text and colored background share the same Tailwind variant scope, and tightens the palette/shade patterns.
- `no-layout-transition-inline` uses word boundaries so it no longer matches property substrings.
- `no-long-transition-duration` exempts infinite / looping animations.
- `no-outline-none` allows `outline: none` alongside a focus-ring class or on elements removed from the tab order (negative `tabIndex`).
- `no-side-tab-border` runs arbitrary hex/rgb/hsl border colors through the same achromatic check as named palette colors.
