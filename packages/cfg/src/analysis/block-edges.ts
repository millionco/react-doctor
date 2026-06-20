import type { BasicBlock } from "../ir/basic-block.js";

// The successor blocks of `block`, dropping edge kinds. The forward
// relation for RPO / dominator walks.
export const successorBlocks = (block: BasicBlock): BasicBlock[] =>
  block.successors.map((edge) => edge.to);

// The predecessor blocks of `block`. The reverse relation, and the input
// to SSA φ construction.
export const predecessorBlocks = (block: BasicBlock): BasicBlock[] =>
  block.predecessors.map((edge) => edge.from);
