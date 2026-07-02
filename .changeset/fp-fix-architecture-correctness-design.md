---
"oxlint-plugin-react-doctor": patch
---

fix(architecture): eliminate false positives across architecture, correctness, and design rules

Hardens ~15 rules so they stop firing on valid code, without weakening the real smell each targets.

Architecture:

- `no-many-boolean-props` requires actual render output before treating a parameter as component props (so non-component factories like `CreateValidator(options)` are skipped; JSX inside `.map`/`useMemo` callbacks still counts), and no longer counts props that are invoked, wired as event handlers (`onClick={showMenu}`), or passed as imperative-prefixed call arguments (`setTimeout(props.showMenu, 100)`) as boolean flags — resolving each name to the component's own props binding, including renamed destructurings.
- `no-nested-component-definition` only flags a nested definition that is actually rendered — as JSX (`<Inner/>`) or by reference through a component prop (`component={Inner}`) — inside its own enclosing component, not a capitalized helper that is merely called (`Inner()`), and no longer leaks a sibling component's `<Inner/>` onto a same-named call-only helper.
- `no-render-in-render` exempts render-prop invocations (`props.renderX()`, `this.props.renderX()`, `props.slots.renderX()` on a nested prop bag, and render props destructured or aliased from props or a component parameter — including defaulted/conditional aliases like `props.renderItem ?? defaultRender`), while still flagging local `render*` helpers, `this.renderX()` class-field calls, and a `render*` parameter of an ordinary nested helper.
- `no-render-prop-children` ignores `render*Props` config bags and literal `render*` mode/flag values, which are not render slots.
- `prefer-module-scope-static-value` no longer hoists initializers that call impure globals (`Date.now()`, `Math.random()`, `crypto.randomUUID()`, `nanoid()`, …) — local helpers that merely share one of those names stay hoistable — and abstains when every reference is a read-only scalar lookup (`KEYS.includes(k)`), where referential identity can't matter.
- `react-compiler-destructure-method` drops `useSearchParams` (its methods are unbound and throw when destructured).
- `react-compiler-no-manual-memoization` leaves `memo(Component, areEqual)` with a custom comparator alone (a nullish second argument still counts as redundant).

Correctness:

- `html-no-invalid-paragraph-child` and `html-no-nested-interactive` stop at JSX attribute boundaries, so an element passed as a prop is no longer treated as a DOM child / nested element — except the explicit `children` prop, which React renders as a real DOM child.
- `no-polymorphic-children` only flags `typeof children` when `children` resolves to the component's props, not a local variable or field that happens to be named `children`.
- `no-prevent-default` skips `<form action=…>` (which has a native no-JS submit path) and anchors whose handler carries positive navigation evidence after `preventDefault()` (`router.push`, `navigate(...)`, `window.open`, delegation to a prop handler) — analytics-only handlers stay flagged as dead links — and stays quiet in test/demo files.
- `no-uncontrolled-input` treats `onInput` as controlling like `onChange`, no longer flags `disabled` inputs (React suppresses its missing-`onChange` warning for `disabled` fields, just like `readOnly`) unless `disabled={false}` is literal, and stays quiet in test/demo files.
- `rendering-svg-precision` requires at least two over-precise token occurrences before reporting, and stays quiet in test/demo/docs-site files.

Design:

- `no-gray-on-colored-background` pairs gray text and colored backgrounds by Tailwind variant scope (order-insensitive, `!important`-aware), including the additive case where a base utility applies under a variant with no same-property override, and tightens the palette/shade patterns.
- `no-layout-transition-inline` matches an exact set of layout property tokens (now also `border-*-width`, `line-height`, `column-width`) so lookalikes such as `stroke-width` no longer match.
- `no-long-transition-duration` exempts infinite / looping animation segments (an animation NAME containing "infinite" still counts) and decorative `aria-hidden` elements.
- `no-outline-none` allows `outline: none` alongside a class that ADDS a visible ring on the element's OWN focus (removal utilities like `focus:ring-0` / `focus:outline-hidden` and `group-focus:`/`peer-focus:` variants don't count) or on elements removed from the tab order (negative `tabIndex`, including conditionals where both branches are negative).
- `no-side-tab-border` runs arbitrary hex/rgb/hsl border colors through the same achromatic check as named palette colors, preferring the color scoped to the flagged side (`border-l-[#e5e7eb]`) over the base border color.
