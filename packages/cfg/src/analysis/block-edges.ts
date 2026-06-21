import type { BasicBlock } from "../ir/basic-block.js";

// The CFG is immutable after construction, so the dropped-edge-kind
// successor / predecessor arrays are stable. The dominator fixpoint and
// the dataflow solver call these once per block per iteration, so memoize
// the allocation instead of rebuilding it via `.map()` every time.
const successorCache = new WeakMap<BasicBlock, BasicBlock[]>();
const predecessorCache = new WeakMap<BasicBlock, BasicBlock[]>();

// The successor blocks of `block`, dropping edge kinds. The forward
// relation for RPO / dominator walks.
export const successorBlocks = (block: BasicBlock): BasicBlock[] => {
  const cached = successorCache.get(block);
  if (cached) return cached;
  const blocks = block.successors.map((edge) => edge.to);
  successorCache.set(block, blocks);
  return blocks;
};

// The predecessor blocks of `block`. The reverse relation, and the input
// to SSA φ construction.
export const predecessorBlocks = (block: BasicBlock): BasicBlock[] => {
  const cached = predecessorCache.get(block);
  if (cached) return cached;
  const blocks = block.predecessors.map((edge) => edge.from);
  predecessorCache.set(block, blocks);
  return blocks;
};
