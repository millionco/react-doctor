// Public surface of `@react-doctor/cfg`. The package is private and its sole
// consumer is `oxlint-plugin-react-doctor`, so this barrel exposes only what
// that consumer imports — the four analysis entry points, their result types,
// and the shared AST helpers. Everything else (the IR, dataflow framework,
// path-feasibility primitives, dominator utilities) is an implementation
// detail reached through deep paths from inside this package and its tests.
export { analyzeControlFlow } from "./control-flow-graph.js";
export type { ControlFlowAnalysis } from "./control-flow-graph.js";
export { analyzeSsa } from "./ssa.js";
export type { SsaAnalysis } from "./ssa.js";
export { analyzeDefiniteAssignment } from "./dataflow/definite-assignment.js";
export type { DefiniteAssignmentAnalysis } from "./dataflow/definite-assignment.js";
export { verifyTypestate } from "./typestate/verify.js";
export type {
  ResourceEvent,
  TypestateViolation,
  VerifyTypestateOptions,
} from "./typestate/verify.js";
export type { TypestateAutomaton } from "./typestate/automaton.js";
export { ssaValueResolver } from "./path/ssa-value-atom.js";
export type { EsTreeNode } from "./ast/es-tree-node.js";
export type { EsTreeNodeOfType } from "./ast/es-tree-node-of-type.js";
export type { EsTreeNodeType } from "./ast/es-tree-node-type.js";
export type { ValueWithType } from "./ast/value-with-type.js";
export { isAstNode } from "./ast/is-ast-node.js";
export { isFunctionLike } from "./ast/is-function-like.js";
export { isNodeOfType } from "./ast/is-node-of-type.js";
export { hasTypeProperty } from "./ast/has-type-property.js";
