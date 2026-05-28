---
name: preact-hydration-mismatches
description: "Use when Preact SSR, prerendering, hydrate(), Suspense, lazy, streaming SSR, renderToStringAsync(), or browser-parsed HTML produces hydration warnings, duplicate nodes, mismatched DOM, lost focus, stale fallback markup, or client-only conditional render bugs."
---

# Preact Hydration Mismatches

Treat hydration bugs as a **server DOM vs. first client VNode** contract problem. Compare against the browser-parsed DOM, not only the string emitted by SSR.

## Triage

1. Import `preact/debug` first in the client entry and reproduce in a real browser.
2. Confirm the app uses `hydrate(<App />, root)` for SSR markup. `render()` is allowed to replace or append, which will wipe the server output.
3. Snapshot `root.innerHTML` before and after hydration. Look for duplicated siblings, removed form state, stale Suspense fallbacks, and parser-inserted nodes.
4. Check whether the bug depends on Preact v10 resumed hydration — v10 has known Suspense/lazy hydration pitfalls that the v11 hydration rework addresses.

## Invariants

- The first client render must produce the same DOM node count, order, and element types as the server output.
- Do not render client-only DOM with `typeof window !== 'undefined' ? <Client /> : null` on the first pass. Render the same placeholder on both sides, then swap in an effect (see `useIsHydrated` below).
- On Preact v10, avoid lazy/Suspense boundaries that resolve to `null`, an empty Fragment, or multiple sibling DOM nodes during resumed hydration. Wrap the boundary output in a single stable element.
- Validate HTML nesting. Browser parser corrections (`<p><h1 /></p>`, malformed tables) create DOM Preact never rendered.

## Fix Patterns

- Wrap async boundary output in one stable element when targeting v10 hydration.
- Use `useId()` only when both server and client run compatible Preact and `preact-render-to-string` versions.
- For random, time, locale, media-query, or storage-dependent values, hydrate with the server value first and update in an effect.
- Test hydrated form controls separately: `defaultValue`, `defaultChecked`, focus, selection, and textarea value are common regression surfaces.

## Client-Only Content Without Mismatch

Share one helper and render the SSR-safe placeholder until after the first commit:

```jsx
import { useEffect, useState } from 'preact/hooks';

export function useIsHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return hydrated;
}

function ClientOnlyClock() {
  const hydrated = useIsHydrated();
  if (!hydrated) return <span>--:--</span>;
  return <span>{new Date().toLocaleTimeString()}</span>;
}
```

Both server and client render `--:--` first, so hydration matches. The real value appears on the next commit.

Doc anchors: [Server-Side Rendering](https://preactjs.com/guide/v10/server-side-rendering), [Debugging Preact Apps](https://preactjs.com/guide/v10/debugging).
