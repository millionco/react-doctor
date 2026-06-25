---
"oxlint-plugin-react-doctor": patch
---

Add 2 new rules that use the structural control-flow graph as a verifier:

- `no-unreachable-code` (Bugs): flags code that never runs because every path above it returns, throws, breaks, continues, or loops forever (via the CFG's `isUnreachable`). Hoisted function declarations, type-only TS declarations, and a bare `var x;` are left alone, matching ESLint's `no-unreachable` carve-outs. Global rule (runs on all JS/TS), so the defensive trailing `throw` after a switch whose every case returns is reported as dead code, consistent with `no-unreachable`.
- `no-set-state-in-render-loop` (Bugs): flags a `useState` setter called inside a render-phase loop (via the CFG's `isInsideLoop`), which fires every iteration and restarts rendering ("Too many re-renders"). Complements `no-set-state-in-render`, which only catches setters that run unconditionally; the two partition cleanly on `isUnconditionalFromEntry`, so an unconditional `for (;;)` / `while (true)` setter is owned by `no-set-state-in-render` and never double-reported. Setters in `.map()` / event-handler / effect callbacks (separate functions) stay quiet.
