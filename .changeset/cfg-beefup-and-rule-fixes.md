---
"oxlint-plugin-react-doctor": patch
---

Beef up the control-flow graph and fix the false positives it exposed.

The internal CFG now exposes reachability, dominance, post-dominance, loop-membership, and unreachable-code primitives, models loop back-edges and infinite loops, and gives `try`/`catch`/`finally` proper finalize/join semantics (a `finally` body stays reachable even when the `try` returns; code after the try is unreachable when no path completes normally). Several rules adopt it:

- `nextjs-no-redirect-in-try-catch` no longer mis-flags `redirect()` / `notFound()` in a `catch` block, in a `finally` block, or in a `try` that has only a `finally` (no `catch`) — none of those swallow the navigation control-flow error.
- `no-mutating-reducer-state` no longer reports a loop that mutates and then `return`s a fresh object (`for (…) { state.items.push(x); return { ...state } }`) when a trailing `return state` only runs on the no-match path.
- `js-hoist-regexp`, `js-index-maps`, and `js-set-map-lookups` no longer mis-flag work inside a callback that merely escapes a loop (the loop-aware check now uses real CFG loop membership instead of lexical nesting depth).
