---
name: preact-signals-react-integration
description: Use when working with @preact/signals-react in React applications, including the Babel transform, useSignals, React 18 or 19 behavior, JSX children versus attributes, SSR, render props, and signal tracking failures.
---

# Preact Signals React Integration

## Core Approach

React integration needs explicit tracking. Prefer the Babel transform. If the transform cannot be used, call `useSignals()` from `@preact/signals-react/runtime` in every component that reads signal `.value` during render.

## Recommended Setup

```json
{
  "plugins": [["module:@preact/signals-react-transform"]]
}
```

React component:

```tsx
import { signal } from "@preact/signals-react";

const count = signal(0);

function Counter() {
  return <button onClick={() => count.value++}>Count: {count.value}</button>;
}
```

Manual fallback:

```tsx
import { useSignals } from "@preact/signals-react/runtime";

function Counter() {
  useSignals();
  return <button onClick={() => count.value++}>Count: {count.value}</button>;
}
```

## Transform Heuristics

The transform defaults to `mode: "auto"` and looks for components with JSX and `.value` member expressions. It can miss:

- render props where another component invokes the function that reads `.value`;
- getters and setters backed by signals;
- components without JSX;
- code already transformed away from JSX unless `detectTransformedJSX` is enabled.

Use `mode: "all"` or `/** @useSignals */` when a component should be tracked but the heuristic cannot see it. Use `/** @noUseSignals */` to opt out.

## JSX Children Versus DOM Attributes

Direct signal JSX children can be optimized:

```tsx
function Label() {
  return (
    <p>
      <>Count: {count}</>
    </p>
  );
}
```

Signals as DOM attributes are not supported by the React integration. Use `.value`:

```tsx
// Bad in React integration.
<input checked={enabled} />

// Good.
<input checked={enabled.value} onChange={e => (enabled.value = e.currentTarget.checked)} />
```

Passing a bare signal as a DOM attribute may have worked accidentally in some React 18 setups, but it is not a documented guarantee and is especially visible with React 19 — always read `.value`.

## SSR And Render Props

- React SSR APIs do not track signals in server environments because SSR renders do not rerender.
- Avoid signal reads hidden inside render props. Put the signal read in a transformed child component or set transform `mode: "all"` when that is appropriate.

## Common Mistakes

- Importing from `@preact/signals` in a React app instead of `@preact/signals-react`.
- Installing the transform but using a build path that does not run Babel on the relevant files.
- Expecting signal DOM attributes to work in React because they work in Preact.
- Forgetting `useSignals()` when the transform is unavailable.
- Using `.value` in JSX and expecting direct text-node optimization instead of component tracking.

## References

- Package docs: `node_modules/@preact/signals-react/README.md`
- Online: https://github.com/preactjs/signals/blob/main/packages/react/README.md
- Transform docs: https://github.com/preactjs/signals/blob/main/packages/react-transform/README.md
