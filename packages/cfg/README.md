# @react-doctor/cfg

Internal (unpublished) per-function **control-flow graph** for an ESTree AST,
plus the dominance / reachability analyses React Doctor's CFG-backed rules run
on. The `oxlint-plugin-react-doctor` package bundles it at build time, so it is
not a runtime dependency of anything published.

It exists so a rule can ask precise control-flow questions — _does this node run
on every path?_, _is this node reachable from that one?_, _is it inside a
loop?_ — instead of pattern-matching the AST and hoping the shape generalizes.
That is the same class of question the React Compiler answers over its HIR and
oxc answers over `oxc_cfg`.

## API

```ts
import { analyzeControlFlow } from "@react-doctor/cfg";

const cfg = analyzeControlFlow(programRoot); // ControlFlowAnalysis
```

`analyzeControlFlow(program)` lazily builds one graph per function it
encounters and returns a `ControlFlowAnalysis`:

| Method                                | Question it answers                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------- |
| `isUnconditionalFromEntry(node)`      | Does `node` run on **every** path from its function's entry to its exit?        |
| `isReachable(fromNode, toNode)`       | Can control flow from `fromNode` to `toNode` within the same function?          |
| `dominates(aNode, bNode)`             | Does `aNode` run on every path that reaches `bNode` (a guard before a sink)?    |
| `postDominates(bNode, aNode)`         | Does `bNode` run on every path from `aNode` to exit (cleanup after a resource)? |
| `isInsideLoop(node)`                  | Is `node`'s block part of a cycle in its own function's CFG?                    |
| `isUnreachable(node)`                 | Is `node`'s block dead code (after an unconditional return / throw / break)?    |
| `cfgFor(fn)` / `enclosingFunction(n)` | The raw `FunctionCfg` (blocks + edges) / the function a node belongs to.        |

Each function boundary (`function` declaration / expression, arrow) gets its own
acyclic-except-for-loops graph; a callback that escapes a loop is **not** inside
that loop because it is a separate function.

## What it models

Statement-level terminals: `if` / `switch` / `for` / `for-in` / `for-of` /
`while` / `do-while` / labeled `break` & `continue` / `return` / `throw` /
`try` / `catch` / `finally` (normal completion is routed through `finalize` /
`join` edges so reachability after a `try` is correct).

Expression-level terminals, lowered into basic blocks the way the React
Compiler lowers its HIR — so a hook or `setState` buried in a branch is seen as
conditional:

- ternary `a ? b : c`
- logical `&&` / `||` / `??` (and logical-assignment `&&=` / `||=` / `??=`)
- optional chaining `a?.b?.()` (each `?.` branches to a shared short-circuit
  target)

Every node maps to the block where its evaluation **completes** (its join
point), which keeps dominance / reachability accurate through nested
expressions.

Deliberately **not** modeled: per-instruction "maybe-throw" edges (every call
can throw); `var` / function-declaration hoisting as a reachability fact (that
is a rule policy, not a CFG fact). Both are documented at the top of
`src/control-flow-graph.ts`.

## Tests & fixture provenance

- `tests/control-flow-graph.oxc-no-unreachable.test.ts` — a port of oxc's
  `eslint/no-unreachable` `pass` / `fail` corpus
  (`crates/oxc_linter/src/rules/eslint/no_unreachable.rs`), asserted directly
  against `isUnreachable`. Each upstream case is rewritten so the statement oxc
  flags becomes a `dead()` marker (must be unreachable) or a `live()` marker
  (must be reachable).
- `tests/control-flow-graph.try-finally.test.ts` — `try` / `catch` / `finally`
  normal-completion edges.
- `tests/control-flow-graph.expression-flow.test.ts` — the expression-level
  terminals above.
- `tests/control-flow-graph.regression.test.ts` — React-shaped regressions
  (conditional hooks, `setState` in a branch).
- `tests/control-flow-graph.test.ts` — core graph construction.

Run `pnpm --filter @react-doctor/cfg test`.
