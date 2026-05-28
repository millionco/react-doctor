---
name: preact-debug-warnings
description: "Use when enabling preact/debug, interpreting Preact debug warnings, invalid HTML nesting or table parser problems, hydration mismatch diagnostics, duplicate keys, invalid refs/events, or component stack traces."
---

# Preact Debug Warnings

`preact/debug` is a development-only addon that attaches validation and diagnostics to Preact's render pipeline. Import it **before** any app code so it can attach before VNodes are created or rendered.

## Enable

```js
// entry file, before rendering your app
if (process.env.NODE_ENV !== 'production') {
  await import('preact/debug');
}
```

With `@preact/preset-vite`, debug is wired for development automatically.

## Diagnose Common Warnings

- **Undefined render parent** — verify the DOM root exists before `render()` or `hydrate()`.
- **Undefined component** — check default vs. named imports.
- **JSX literal passed as component** — render the VNode value directly instead of `<Foo />`.
- **Invalid table or paragraph nesting** — browsers silently wrap or close tags, causing VDOM/DOM divergence. Compare the browser-parsed DOM (`root.innerHTML`) against your JSX tree.
- **Invalid event / ref** — event handlers must be functions or `null`; refs must be callback refs or object refs (`createRef()` / `useRef()`).
- **Duplicate keys** — keys must be unique among siblings of the same parent.
- **Hydration mismatch** — see the [preact-hydration-mismatches](../preact-hydration-mismatches/SKILL.md) skill. Compare the SSR string against what the browser parser actually produced.

## Reading Component Stacks

`preact/debug` extends warnings with a component stack trace showing the path from the root to the offending VNode. Use it to locate the component that emitted the bad prop, key, or nesting.

Doc anchors: [Debugging Preact Apps](https://preactjs.com/guide/v10/debugging).
