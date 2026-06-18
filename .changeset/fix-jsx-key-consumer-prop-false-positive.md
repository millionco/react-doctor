---
"oxlint-plugin-react-doctor": patch
---

Stop `jsx-key` from flagging element collections handed to a non-`children` prop (e.g. `<Tabs items={[<Tab />, <Tab />]} />`).

The rule decided whether an element needed a `key` purely from its structural position — "is this JSX inside an array literal or a `.map`/`.flatMap`/`Array.from` callback?" — and never looked at where the resulting collection was consumed. React's dev-mode key validation only iterates `props.children` (`jsxWithValidation` → `validateChildKeys(props.children, type)`), so an element array passed to any other prop is never key-validated at the call site; the receiving component owns keying (the `cloneElement` / `Children.map` / `Children.toArray` idiom). Flagging the producer site was a false positive — the same "data handoff, not a sibling render" reasoning the rule already applies to object-`Property` values.

The fix exempts collections that are the value of a non-`children` JSX attribute, for both array literals and iterator callbacks — including when the value is wrapped in optional chaining, `&&`/`||`/`??`, a ternary branch, or a TS `as` / `satisfies` / `!` assertion (`items={ready && xs.map(...)}`), since none of those change whether React validates it.

Genuine missing keys still fire: array literals and `.map` results in **children** position (`<Menu>{data.map(...)}</Menu>`, `<ul>{[<li/>, <li/>]}</ul>`), and the explicit `children={[...]}` attribute — which _is_ `props.children` and which React does validate.
