import type { EsTreeNode } from "../ast/es-tree-node.js";
import type { Instruction } from "./instruction.js";
import type { Phi } from "./place.js";
import type { Terminal } from "./terminal.js";

// Per-function CFG. Mirrors the subset of `oxc_cfg` we need to answer:
// "Is this AST node guaranteed to execute on every call to its
// enclosing function?" (isUnconditionalFromEntry — used by rules-of-hooks)
//
// Edge kinds, mapped from oxc_cfg's richer `EdgeType` taxonomy to the
// distinctions our analyses actually consume:
//   uncond   — sequential fall-through (oxc `Normal`)
//   cond     — a conditional branch: true / false / loop-enter / case
//              (oxc `Jump` + the `Normal` else-arm; we don't split them
//              because reachability/dominance weight every edge equally)
//   backedge — a loop's back-edge to its header (oxc `Backedge`); the
//              sole creator of cycles, so loop detection keys off it
//   throw    — an exception path to a catch/finally or the function exit
//              (oxc `Error`); excluded from "normal completion" reachability
//   finalize — entry into a `finally` block, taken on every path through
//              the protected region — even a `return`/`throw` in `try`
//              (oxc `Finalize`). An abrupt completion can't sever it, so
//              the `finally` body stays reachable.
//   join     — the normal continuation after a `finally` completes, added
//              only when the protected region can itself complete normally
//              (oxc `Join`). Its absence is what makes code after
//              `try { return } finally { … }` unreachable.
// oxc's `NewFunction` edge is absent by construction: every function gets
// its own CFG here, so reachability never crosses a function boundary.
//
// Coverage vs. the React Compiler's HIR terminal taxonomy (the canonical
// JS-side CFG, `BuildHIR.ts`). The compiler's terminals are: goto, if,
// branch, switch, logical, ternary, optional, return, throw, do-while,
// while, for, for-of, for-in, label, sequence, maybe-throw, try. We model
// every one as basic blocks + the edges above (see `Terminal`):
//   - Statement terminals (if / switch / loops / label / return / throw /
//     try) → `buildStatement`.
//   - Expression terminals — `ternary`, `logical` (`&&`/`||`/`??` and the
//     `&&=`/`||=`/`??=` assignments), and `optional` (optional chaining) —
//     → `buildExpression` / `buildOptionalChainLink`. Lowering these is what
//     lets a hook / setState / effect nested in a short-circuit read as
//     conditional, exactly like the compiler's value blocks. `sequence`
//     (comma / value-block sequencing) needs no dedicated terminal here:
//     the generic left-to-right child threading already orders it.
//   - `maybe-throw` (an implicit edge to the nearest handler after EVERY
//     throwable instruction) is modeled coarsely: a single `cond` edge from
//     the try ENTRY to the catch. That already makes every later try-body
//     block skippable via the catch bypass, so the primitives our rules
//     consume (`isUnconditionalFromEntry`, post-dominance) get the same
//     answer a per-instruction model would give. The only thing the coarse
//     model loses is `isReachable(midTryStatement, catchStatement)`, which
//     no rule needs — so per-instruction maybe-throw is a deliberate
//     non-goal, not a gap.
export type CfgEdgeKind = "uncond" | "cond" | "throw" | "backedge" | "finalize" | "join";

export interface CfgEdge {
  readonly from: BasicBlock;
  readonly to: BasicBlock;
  readonly kind: CfgEdgeKind;
}

export interface BasicBlock {
  readonly id: number;
  readonly instructions: Instruction[];
  // Set as the block is built; blocks that merely fall through are
  // back-filled with a `goto` (or `unreachable` for orphans) in
  // buildFunctionCfg. Mutable only during construction.
  terminal: Terminal;
  readonly successors: CfgEdge[];
  readonly predecessors: CfgEdge[];
  // φ-functions inserted at this block's head by SSA construction. Empty
  // for every block unless `analyzeSsa` has run over the enclosing
  // function, so non-SSA consumers pay nothing.
  readonly phis: Phi[];
}

export interface FunctionCfg {
  readonly owner: EsTreeNode;
  readonly entry: BasicBlock;
  readonly exit: BasicBlock;
  readonly blocks: BasicBlock[];
  readonly blockOf: (node: EsTreeNode) => BasicBlock | null;
}
