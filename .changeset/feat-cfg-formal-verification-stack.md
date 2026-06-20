---
"oxlint-plugin-react-doctor": patch
---

Add a formal-verification stack to the control-flow graph and three path-sensitive rules.

`@react-doctor/cfg` gains four layers on top of its CFG/SSA engine, all pure-TS, bundled at build time, lazy (a rule that never reads a layer pays nothing), and run once per scan:

- **Dataflow framework** — `solveDataflow`, a generic monotone worklist fixpoint over a `Lattice<Fact>` (one solver subsumes many analyses), and `analyzeDefiniteAssignment` built on it: a forward must-analysis over the SSA occurrence stream answering _is this read reached unassigned on some path?_ (a `declare` like `let x;` is neither read nor write, so a bare declaration never counts as an assignment).
- **Typestate engine** — `verifyTypestate(cfg, { automaton, classifier })` generalizes resource-protocol checking into a reusable automaton verified over the CFG, reporting error transitions (an illegal event) and leaked resources (a resource left non-accepting on a normal-completion path). Events are attributed to their real block and deduplicated, so the whole-body implicit-return never double-counts a call.
- **Path feasibility** — a bounded, dependency-free checker (`isPathFeasible` + `lowerGuard` / `pathConditionFacts`) that lowers a path's branch guards into facts over SSA values and refutes correlated-branch counterexamples via union-find congruence closure. It only ever _suppresses_ a diagnostic when the path search is complete and every counterexample is provably infeasible (e.g. `if (x) open(); … if (x) close();`), so it strictly removes false positives and is never unsound for bug-finding.

Three new rules consume them:

- `correctness/no-use-before-define` — a block-scoped binding (`let` / `const` / `class` / `using`) used lexically before its declaration runs, in the same synchronous execution, which always throws a `ReferenceError` from the Temporal Dead Zone. Sound by construction: quiet for hoisted `var` / function declarations, params, globals, and any access nested in a closure or class body that may run after the declaration. A declared-but-unassigned `let` read (`let x; if (c) x = 1; use(x)`) is `undefined`, not a TDZ crash, so it is deliberately not reported.
- `state-and-effects/no-stale-closure-capture` — a render-phase closure (a hook callback or handler) that captures a `let` binding reassigned later in the same render, so the closure sees a stale value. Quiet for `const` and bindings never reassigned after capture.
- `state-and-effects/no-unreleased-resource` — a resource opened inside a React effect callback (timer, subscription, event listener, `AbortController`) and released INLINE on some paths but leaked on an early return. Scoped to `useEffect` / `useLayoutEffect` / `useInsertionEffect` (including the namespaced `React.useEffect` form): the returned-cleanup contract stays owned by `effect-cleanup-not-on-every-path`, a `finally`-based release counts as run-on-every-path, and non-effect functions (class lifecycle methods, non-React frameworks like Solid's `createEffect`/`onCleanup`) are left alone.
