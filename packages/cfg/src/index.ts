export { analyzeControlFlow, cfgToDot } from "./control-flow-graph.js";
export type {
  BasicBlock,
  CfgEdge,
  CfgEdgeKind,
  ControlFlowAnalysis,
  DominatorTree,
  FunctionCfg,
  GotoVariant,
  Instruction,
  InstructionKind,
  Terminal,
  TerminalCase,
} from "./control-flow-graph.js";
export { analyzeSsa } from "./ssa.js";
export type { FunctionSsa, SsaAnalysis } from "./ssa.js";
export type { BindingId, Phi, Place, ResolveBinding, SsaIdentifier } from "./ir/place.js";
// Layer A — generic monotone dataflow framework + the analyses built on it.
export { solveDataflow } from "./dataflow/solve.js";
export type { DataflowDirection, DataflowResult, DataflowSpec } from "./dataflow/solve.js";
export type { Lattice } from "./dataflow/lattice.js";
export { analyzeDefiniteAssignment } from "./dataflow/definite-assignment.js";
export type {
  DefiniteAssignmentAnalysis,
  DefiniteAssignmentOptions,
} from "./dataflow/definite-assignment.js";
// Layer C — typestate protocol engine.
export { verifyTypestate } from "./typestate/verify.js";
export type {
  ResourceEvent,
  TypestateClassifier,
  TypestateViolation,
  VerifyTypestateOptions,
} from "./typestate/verify.js";
export type { TypestateAutomaton } from "./typestate/automaton.js";
// Layer D — bounded path-feasibility checker.
export { isPathFeasible } from "./path/feasibility.js";
export type { Feasibility } from "./path/feasibility.js";
export { lowerGuard, pathConditionFacts } from "./path/path-condition.js";
export type { ResolveValueAtom } from "./path/path-condition.js";
export { enumerateSimplePaths } from "./path/enumerate-paths.js";
export type { SimplePathQuery, SimplePathResult } from "./path/enumerate-paths.js";
export { everyCounterexampleInfeasible } from "./path/prune-infeasible.js";
export { ssaValueResolver } from "./path/ssa-value-atom.js";
export { atomKey, constAtomOf, createUnionFind, valueAtom } from "./path/literal-facts.js";
export type { Atom, PathFact, UnionFind } from "./path/literal-facts.js";
export { createLexicalBindingResolver } from "./analysis/lexical-binding-resolver.js";
// Exported for SSA verification: the iterated dominance frontier of a
// binding's defs is the classical oracle for φ placement.
export { computeDominatorTree, computePostDominatorTree } from "./analysis/dominators.js";
export { predecessorBlocks, successorBlocks } from "./analysis/block-edges.js";
export type { EsTreeNode } from "./ast/es-tree-node.js";
export type { EsTreeNodeOfType } from "./ast/es-tree-node-of-type.js";
export type { EsTreeNodeType } from "./ast/es-tree-node-type.js";
export { isAstNode } from "./ast/is-ast-node.js";
export { isFunctionLike } from "./ast/is-function-like.js";
export { isNodeOfType } from "./ast/is-node-of-type.js";
