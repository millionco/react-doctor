import type { EsTreeNode } from "../ast/es-tree-node.js";
import type { BasicBlock } from "./basic-block.js";

// Opaque, analysis-stable identity for a resolved local binding (a
// var/let/const/param/function/catch declaration). Equality is all that
// matters: two identifier references resolve to the same `BindingId` iff
// they denote the same declaration. The cfg's built-in lexical resolver
// mints these; a host (the oxlint plugin) may inject its own numbering.
export type BindingId = number;

// One SSA value: a specific version of a binding. `binding` + `version`
// is the identity (interned, so reference equality works); `name` is the
// source identifier carried for DOT / debugging. Mirrors the React
// Compiler's `IdentifierId`-per-version model, variable-level.
export interface SsaIdentifier {
  readonly binding: BindingId;
  readonly version: number;
  readonly name: string;
}

// A read or write occurrence of a binding at a concrete identifier node —
// the per-instruction operand / lvalue the Braun builder consumes. The
// React Compiler's `Place`; we keep only what variable-level SSA needs.
// `read` / `write` are operands and stores. `declare` is a binding
// introduced without a value (`let x;`): SSA treats it as a def (it
// establishes a version, standing for `undefined`), but definite-assignment
// must NOT count it as an assignment — a later read still reaches no store.
export interface Place {
  readonly binding: BindingId;
  readonly name: string;
  readonly kind: "read" | "write" | "declare";
  readonly node: EsTreeNode;
}

// Maps an identifier node to the binding it references, or null for an
// unresolved / global identifier (opaque to SSA, like the React
// Compiler's `#unknown` globals). The injectable seam between the cfg and
// a host scope analyzer.
export type ResolveBinding = (identifier: EsTreeNode) => BindingId | null;

// A φ-function sitting at the head of a join block: the merged value of a
// binding whose definition differs across the block's predecessors.
// `operands` maps each predecessor block to the SSA value live on that
// in-edge (Braun et al. 2013, "Simple and Efficient Construction of SSA").
export interface Phi {
  readonly identifier: SsaIdentifier;
  readonly operands: Map<BasicBlock, SsaIdentifier>;
}
