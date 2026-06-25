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

| Method                                | Question it answers                                                               |
| ------------------------------------- | --------------------------------------------------------------------------------- |
| `isUnconditionalFromEntry(node)`      | Does `node` run on **every** path from its function's entry to its exit?          |
| `isReachable(fromNode, toNode)`       | Can control flow from `fromNode` to `toNode` within the same function?            |
| `dominates(aNode, bNode)`             | Does `aNode` run on every path that reaches `bNode` (a guard before a sink)?      |
| `postDominates(bNode, aNode)`         | Does `bNode` run on every path from `aNode` to exit (cleanup after a resource)?   |
| `isInsideLoop(node)`                  | Is `node`'s block part of a cycle in its own function's CFG?                      |
| `isUnreachable(node)`                 | Is `node`'s block dead code (after an unconditional return / throw / break)?      |
| `dominanceFrontier(node)`             | The dominance frontier of `node`'s block (Cytron et al.) — the SSA seam.          |
| `isInfiniteLoopStart(node)`           | Is the loop's test a compile-time truthy constant (oxc `is_infinite_loop_start`)? |
| `toDot(fn)`                           | Graphviz DOT of the function's CFG (debugging / parity snapshots).                |
| `cfgFor(fn)` / `enclosingFunction(n)` | The raw `FunctionCfg` (blocks + edges) / the function a node belongs to.          |

Each function boundary (`function` declaration / expression, arrow) gets its own
acyclic-except-for-loops graph; a callback that escapes a loop is **not** inside
that loop because it is a separate function.

## Internal model

Each `BasicBlock` is a typed `Instruction[]` (oxc's `InstructionKind`:
`statement` / `condition` / `iteration` / `return` / `implicit-return` /
`throw` / `break` / `continue`) ending in a first-class `Terminal`. The
`Terminal` union mirrors the React Compiler HIR taxonomy (`HIR/HIR.ts`):
`goto` / `if` / `switch` / `while` / `do-while` / `for` / `for-in` / `for-of` /
`logical` / `ternary` / `optional` / `try` / `return` / `throw` /
`unreachable`. Branching terminals carry a `fallthrough` join block (the
compiler's `TerminalWithFallthrough`), and `break` / `continue` are lowered to
explicit `goto` terminals at their resolved targets.

Dominators and post-dominators use the **Cooper–Harvey–Kennedy** "A Simple,
Fast Dominance Algorithm" immediate-dominator tree over reverse-postorder (the
same algorithm the React Compiler uses), and we also compute the dominance
frontier (Cytron et al.) — both the public `dominanceFrontier` seam and the
verification oracle for the SSA layer below.

## SSA (`analyzeSsa`)

Variable-level **static single assignment** form over the same CFG, so a rule
can ask value-flow questions — _which definition reaches this use?_, _is this
write dead?_, _is this binding reassigned between two points?_ — that pure
control flow can't answer.

```ts
import { analyzeSsa } from "@react-doctor/cfg";

// Self-contained: a built-in lexical resolver assigns binding identities.
const ssa = analyzeSsa(programRoot);

// Or inject a host scope analyzer's binding ids (the oxlint plugin does this):
const ssa = analyzeSsa(programRoot, (idNode) => scopes.symbolFor(idNode)?.id ?? null);
```

| Method                                  | Question it answers                                              |
| --------------------------------------- | ---------------------------------------------------------------- |
| `versionAt(node)`                       | The SSA value read or written at an identifier node.             |
| `reachingDefinition(useNode)`           | The SSA value that flows into a use (its reaching def).          |
| `isLiveValue(identifier)`               | Is this value ever read (directly or through a live φ)?          |
| `isRedefinedBetween(from, to, binding)` | Is `binding` written on a path between two nodes?                |
| `bindingOf(node)` / `ssaFor(fn)`        | The binding an identifier denotes / per-function φ + def blocks. |

Construction is the **Braun, Buchwald, Hack et al. (2013)** on-the-fly
sealed-block algorithm — the same algorithm the React Compiler's `EnterSSA`
implements — followed by their `EliminateRedundantPhi` fixpoint pass. It needs
only `BasicBlock.predecessors`, per-block read/write occurrences, and a version
counter; no dominator tree. The dominance frontier is used purely as the test
oracle: minimal-SSA φ placement equals the iterated dominance frontier of each
binding's definitions (Cytron et al.), and the parity suite asserts exactly
that. Scope is variable-level (no field-level / `ObjectShape` SSA, no type
inference, no out-of-SSA `LeaveSSA`); a binding read inside a nested function is
a closure capture the per-function form leaves opaque.

The algorithm is a clean-room port of the **MIT-licensed** React Compiler
SSA (`babel-plugin-react-compiler/src/SSA`), carrying no Babel dependency —
attribution only.

### Source layout

- `src/ir/` — the data model (`instruction.ts`, `terminal.ts`, `basic-block.ts`).
- `src/build/` — lowering (`cfg-builder.ts`, `build-expression.ts`,
  `build-statement.ts`, `build-function-cfg.ts`).
- `src/analysis/` — `reverse-postorder.ts`, `dominators.ts` (forward +
  post-dominator trees + frontier), `reachability.ts`, `unconditional.ts`,
  `loops.ts`, `node-order.ts`, `block-edges.ts`. SSA: `defs-uses.ts`
  (occurrence extraction), `lexical-binding-resolver.ts` (built-in resolver),
  `enter-ssa.ts` (Braun construction), `eliminate-redundant-phi.ts`.
- `src/ir/place.ts` — the SSA value model (`SsaIdentifier` / `Place` / `Phi`).
- `src/dot.ts` — Graphviz export (renders φ-functions). `src/constant-condition.ts`
  — the infinite-loop constant folder. `src/control-flow-graph.ts` — assembles
  `analyzeControlFlow`; `src/ssa.ts` — assembles `analyzeSsa`.

## Formal-verification stack

Four layers build on the CFG/SSA above to answer _bug-finding_ questions
soundly. Everything is pure-TS, bundled at build time, lazy (a rule that never
reads a layer pays nothing), and runs once per scan — never in a hot loop.

### Dataflow framework (`solveDataflow`, Layer A)

A generic monotone worklist fixpoint over the CFG. Give it a `Lattice<Fact>`
(`bottom` / `join` / `equals`), a `direction`, a `boundary` fact, and a
`transfer(block, inFact)`; it iterates reverse-postorder (forward) or its
reverse (backward) to a fixpoint and returns per-block entry/exit facts. One
solver subsumes many analyses.

```ts
import { solveDataflow, analyzeDefiniteAssignment } from "@react-doctor/cfg";
```

`analyzeDefiniteAssignment(program, resolveBinding?, { resolveValue? })` is the
first analysis built on it: a forward _must_ analysis (set-intersection at
joins) over the SSA occurrence stream. `isMaybeUnassignedAt(node)` answers
_does some entry→read path reach this read with no prior write?_ — the signal a
TDZ / read-before-write rule keys off. A `declare` occurrence (`let x;`) is
neither a read nor a write, so a bare declaration never counts as an assignment.

### Typestate protocol engine (`verifyTypestate`, Layer C)

Generalizes resource-protocol checking (e.g. the hand-rolled
effect-cleanup leak rule) into a reusable automaton verified over the CFG.

```ts
import { verifyTypestate } from "@react-doctor/cfg";

verifyTypestate(cfg, { automaton, classifier, resolveValue? });
```

A `TypestateAutomaton` is `{ initial, transition(state, event), errorStates,
acceptingStates }`; the `classifier` maps each instruction node to the protocol
events (`{ resource, event, node }`) in its subtree. Built on `solveDataflow`
(fact = each resource's set of possible states, joined by union), it reports two
failure modes: an **error transition** (an illegal event drove a resource into
an error state) and a **leaked resource** (a resource resting in a non-accepting
state on a normal-completion path — the exit joined over non-`throw`
predecessors). Events are attributed to the block they actually execute in
(`cfg.blockOf`) and deduplicated by node, so the whole-body `implicit-return`
instruction never double-counts a call.

### Path feasibility (`isPathFeasible`, Layer D)

A bounded, dependency-free consistency checker that refines B/C by **pruning
infeasible counterexample paths**. `lowerGuard` / `pathConditionFacts` lower a
path's branch guards (`if` / `&&` / `||` / `!` / equality) into facts over SSA
values (keyed by `versionAt`, so the _same_ value at two branches is one atom).
`isPathFeasible(facts)` runs a union-find congruence closure plus truthiness /
disequality constraints and returns `feasible` / `infeasible` / `unknown`
(`unknown` past the caps in `constants.ts`).

The integration is deliberately one-directional: a diagnostic is suppressed
**only** when the path search is complete and _every_ counterexample is provably
`infeasible`. Any `feasible` / `unknown` counterexample, or an incomplete search,
leaves the diagnostic standing — so Layer D only ever removes false positives
(e.g. `if (x) open(); … if (x) close();` — the open-without-close path needs `x`
truthy and falsy at once) and is never unsound for bug-finding. Opt in by
passing `resolveValue` to `analyzeDefiniteAssignment` / `verifyTypestate`.

Source: `src/dataflow/` (`lattice.ts`, `solve.ts`, `definite-assignment.ts`),
`src/typestate/` (`automaton.ts`, `verify.ts`), `src/path/`
(`literal-facts.ts`, `path-condition.ts`, `feasibility.ts`,
`enumerate-paths.ts`, `prune-infeasible.ts`). Tested by `tests/dataflow.test.ts`,
`tests/typestate.test.ts`, `tests/path-feasibility.test.ts`.

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
`src/ir/basic-block.ts`.

## Tests & fixture provenance

Parity is the deliverable: curated slices of three upstream suites, asserted
through the primitives above (and terminal-shape snapshots), so we can claim we
replicate oxc / ESLint / React Compiler CFG semantics.

- `tests/control-flow-graph.oxc-no-unreachable.test.ts` — full port of oxc's
  `eslint/no-unreachable` `pass` / `fail` corpus
  (`crates/oxc_linter/src/rules/eslint/no_unreachable.rs`), via `isUnreachable`
  (`dead()` / `live()` markers).
- `tests/control-flow-graph.oxc-no-fallthrough.test.ts` — oxc's
  `eslint/no_fallthrough.rs`, as switch-case `isReachable` facts.
- `tests/control-flow-graph.oxc-no-unsafe-finally.test.ts` — oxc's
  `eslint/no_unsafe_finally.rs`: an abrupt `finally` swallows normal completion.
- `tests/control-flow-graph.returns-every-path.test.ts` — oxc's
  `eslint/getter_return.rs` / `consistent-return` post-dominance shapes.
- `tests/control-flow-graph.eslint-code-path.test.ts` — representative ESLint
  code-path-analysis segment reachability (`no-unreachable`, `consistent-return`).
- `tests/control-flow-graph.react-compiler.test.ts` — React Compiler `BuildHIR`
  control-flow shapes (if / switch / loops / try / logical / ternary / optional).
- `tests/control-flow-graph.terminal-shape.test.ts` — each construct lowers to
  its React Compiler HIR `Terminal` kind.
- `tests/control-flow-graph.loops-dot.test.ts` — `isInfiniteLoopStart` const
  folding + a DOT export snapshot.
- `tests/control-flow-graph.try-finally.test.ts` — `try` / `catch` / `finally`
  normal-completion edges.
- `tests/control-flow-graph.expression-flow.test.ts` — the expression-level
  terminals above.
- `tests/control-flow-graph.regression.test.ts` — React-shaped regressions
  (conditional hooks, `setState` in a branch).
- `tests/control-flow-graph.test.ts` — core graph construction.
- `tests/ssa.test.ts` — SSA φ-placement parity vs. the iterated dominance
  frontier oracle, value queries, and the φ DOT rendering.

Run `pnpm --filter @react-doctor/cfg test`.
