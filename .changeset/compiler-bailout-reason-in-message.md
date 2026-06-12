---
"react-doctor": patch
---

Carry the React Compiler bail-out reason in the primary diagnostic message. `react-hooks-js/*` diagnostics previously all rendered the same generic "This component misses React Compiler's automatic memoization…" message, with the specific reason relegated to `help`. The message now includes the first line of the compiler's reason (e.g. `useMemo() callbacks may not be async or generator functions`) so contexts that only show the message explain _why_ the compiler bailed; the reason's remaining lines stay in `help`, so the rendered message + suggestion never repeat the same sentence. `todo` diagnostics keep the generic message — their reasons are compiler-internal work notes, not user-facing copy. Because diagnostics dedupe on their full message, two _different_ bail-out reasons anchored at the same source location now survive as two diagnostics instead of collapsing into one, so counts can rise slightly on affected projects.
