---
"oxlint-plugin-react-doctor": patch
---

perf(rules): hoist per-file directory classification out of per-node visitors — the TanStack Start and Next.js rules that called `isInProjectDirectory` (or tested the root-route filename pattern) on every JSX element / call expression now compute it once in `create()` and skip non-matching files entirely
