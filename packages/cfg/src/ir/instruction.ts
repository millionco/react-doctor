import type { EsTreeNode } from "../ast/es-tree-node.js";

// A single entry inside a basic block, mirroring oxc_cfg's
// `InstructionKind` so a block reads as a typed instruction list ending
// in a `Terminal` rather than an opaque AST-node bag.
export type InstructionKind =
  | "statement"
  | "condition"
  | "iteration"
  | "throw"
  | "return"
  | "implicit-return"
  | "break"
  | "continue"
  | "unreachable";

export interface Instruction {
  readonly node: EsTreeNode;
  readonly kind: InstructionKind;
}
