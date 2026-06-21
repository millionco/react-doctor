import type { EsTreeNode } from "../ast/es-tree-node.js";
import { forEachChildNode } from "../ast/for-each-child-node.js";
import { isFunctionLike } from "../ast/is-function-like.js";
import type { BasicBlock, CfgEdge, CfgEdgeKind } from "../ir/basic-block.js";
import type { InstructionKind } from "../ir/instruction.js";
import type { Terminal } from "../ir/terminal.js";

export interface CfgBuilder {
  nextBlockId: number;
  blocks: BasicBlock[];
  entry: BasicBlock;
  exit: BasicBlock;
  // Map every AST node visited inside this function to the block it
  // was appended to.
  nodeBlock: Map<EsTreeNode, BasicBlock>;
  // Monotonic nesting counter shared by loops and switches. An unlabeled
  // `break` targets the innermost enclosing loop OR switch, so we compare
  // the `seq` of each stack's top to find which was entered last.
  breakScopeSeq: number;
  // Stack of "loop-merge" / "loop-header" pairs for break/continue.
  loopStack: Array<{ header: BasicBlock; merge: BasicBlock; label: string | null; seq: number }>;
  // Stack of "switch-merge" + label, for break in switches.
  switchStack: Array<{ merge: BasicBlock; label: string | null; seq: number }>;
  // Stack of try-catch contexts: where to route ThrowStatement to.
  tryStack: Array<{ catch: BasicBlock | null; finally: BasicBlock | null }>;
  // Labels currently in scope: maps label name → loop/switch entry.
  labelStack: Array<{ label: string; merge: BasicBlock; header: BasicBlock | null }>;
}

export const createBuilder = (): CfgBuilder => ({
  nextBlockId: 0,
  blocks: [],
  entry: null as unknown as BasicBlock,
  exit: null as unknown as BasicBlock,
  nodeBlock: new Map(),
  breakScopeSeq: 0,
  loopStack: [],
  switchStack: [],
  tryStack: [],
  labelStack: [],
});

export const createBlock = (builder: CfgBuilder): BasicBlock => {
  const block: BasicBlock = {
    id: builder.nextBlockId++,
    instructions: [],
    // Sentinel; back-filled to `goto`/`unreachable` once the block's
    // successors are known (see finalizeTerminals).
    terminal: { kind: "unreachable" },
    successors: [],
    predecessors: [],
    phis: [],
  };
  builder.blocks.push(block);
  return block;
};

export const addEdge = (from: BasicBlock, to: BasicBlock, kind: CfgEdgeKind): void => {
  const edge: CfgEdge = { from, to, kind };
  from.successors.push(edge);
  to.predecessors.push(edge);
};

export const setTerminal = (block: BasicBlock, terminal: Terminal): void => {
  block.terminal = terminal;
};

export const appendInstruction = (
  block: BasicBlock,
  node: EsTreeNode,
  kind: InstructionKind,
): void => {
  block.instructions.push({ node, kind });
};

export const appendNode = (builder: CfgBuilder, block: BasicBlock, node: EsTreeNode): void => {
  appendInstruction(block, node, "statement");
  if (!builder.nodeBlock.has(node)) {
    builder.nodeBlock.set(node, block);
  }
};

// Recursively map every descendant of `node` to `block`, EXCEPT when
// crossing a function boundary (inner functions get their own CFG).
export const mapDescendantsToBlock = (
  builder: CfgBuilder,
  node: EsTreeNode,
  block: BasicBlock,
): void => {
  builder.nodeBlock.set(node, block);
  if (isFunctionLike(node)) return;
  forEachChildNode(node, (child) => mapDescendantsToBlock(builder, child, block));
};
