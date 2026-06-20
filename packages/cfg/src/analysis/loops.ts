import type { BasicBlock, FunctionCfg } from "../ir/basic-block.js";

// A block is on a cycle iff it can reach itself by following non-throw
// successor edges (loop back-edges are normal "uncond" edges; a
// throw→catch edge is not a loop).
export const computeCyclicBlocks = (cfg: FunctionCfg): Set<BasicBlock> => {
  const cyclicBlocks = new Set<BasicBlock>();
  for (const startBlock of cfg.blocks) {
    const visited = new Set<BasicBlock>();
    const queue: BasicBlock[] = [];
    for (const edge of startBlock.successors) {
      if (edge.kind !== "throw") queue.push(edge.to);
    }
    let isOnCycle = false;
    while (queue.length > 0) {
      const block = queue.shift()!;
      if (block === startBlock) {
        isOnCycle = true;
        break;
      }
      if (visited.has(block)) continue;
      visited.add(block);
      for (const edge of block.successors) {
        if (edge.kind !== "throw") queue.push(edge.to);
      }
    }
    if (isOnCycle) cyclicBlocks.add(startBlock);
  }
  return cyclicBlocks;
};
