---
"oxlint-plugin-react-doctor": minor
---

Turn the control-flow graph into a React verifier: model expression-level control flow and add a path-sensitive effect-leak rule.

The CFG now lowers expression-level control flow the way the React Compiler's HIR does — a ternary's arms, a `&&` / `||` / `??` (and `&&=` / `||=` / `??=`) right operand, and an optional chain's links past each `?.` all get their own basic blocks. A hook / `setState` / effect short-circuited inside any of those is now correctly seen as conditional, which statement-level lowering alone could not see.

Two rules use it as a verifier:

- New `effect-cleanup-not-on-every-path`: flags a subscription/timer acquired in an effect whose cleanup is skipped on an early-return path (`const id = setInterval(…); if (skip) return; return () => clearInterval(id)` leaks on the `skip` path). This is a reachability question no AST shape can answer — it complements `effect-needs-cleanup` (which only checks a cleanup exists at all) and stays quiet when the guard runs before the acquisition or when every return path cleans up.
- `no-set-state-in-render` now flags any setter the CFG proves runs on every render path (`isUnconditionalFromEntry`), not just a bare top-level statement — so `const x = setCount(c + 1)` and unconditional blocks are caught, while the guarded store-previous-render fixed-point pattern (`if (prev !== count) setPrev(count)`) stays quiet.
