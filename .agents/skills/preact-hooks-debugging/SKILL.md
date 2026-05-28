---
name: preact-hooks-debugging
description: "Use when Preact hooks fail with invalid hook calls, __H undefined or null errors, mixed CJS/ESM imports, no-build import maps, duplicate Preact copies, useId SSR mismatches, or effect scheduling problems."
---

# Preact Hooks Debugging

Most hard hook failures are caused by either invalid hook order or two different Preact module instances loaded into the same app.

## Fast Checks

1. Import hooks from `preact/hooks` or `preact/compat`, not a second bundled copy.
2. Confirm all entry points resolve to the same `preact` package instance. Check bundler aliases, linked packages, test-runner aliases, and CDN import maps.
3. For no-build apps, map both `preact` and `preact/` to the same exact version so `preact/hooks` shares core state. See the [preact-no-build-vite-setup](../preact-no-build-vite-setup/SKILL.md) skill.
4. Hooks must run only during function component render and in the same order on every render (no conditional or looped hook calls).
5. If the error mentions `__H`, inspect module duplication *before* changing hook code — the symptom points at installation, not your component.

## Duplicate-Copy Quick Diagnostic

```js
// paste once in a DevTools console for a running app
const mods = performance.getEntriesByType('resource')
  .map(e => e.name)
  .filter(n => /preact(\.module)?(\?|$|\/hooks)/.test(n));
console.log(mods);
```

Two distinct URLs for `preact` (different versions, or the same version fetched from both `npm` and a CDN) will cause `__H` crashes and context splits.

## SSR and Effects

- `useId()` requires compatible Preact on both server and client, plus a compatible `preact-render-to-string` version. Upgrade together.
- `useEffect()` runs after paint; `useLayoutEffect()` runs during commit. Do not rely on either to create DOM that must exist for the first hydration pass — the server output must already contain it.
- Effect scheduling is influenced by `options.requestAnimationFrame`; any custom scheduler must preserve async post-render semantics.
- In tests, wrap updates with `act()` from `@testing-library/preact` (or your test harness's equivalent) so effects flush before assertions.

Doc anchors: [Hooks](https://preactjs.com/guide/v10/hooks), [Differences to React](https://preactjs.com/guide/v10/differences-to-react).
