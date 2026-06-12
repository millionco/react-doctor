---
"react-doctor": patch
---

Carry the React Compiler bail-out reason in the primary diagnostic message. `react-hooks-js/*` diagnostics previously all rendered the same generic "This component misses React Compiler's automatic memoization…" message, with the specific reason relegated to `help`. The message now includes the compiler's reason summary (e.g. `useMemo() callbacks may not be async or generator functions`) so contexts that only show the message explain *why* the compiler bailed.
