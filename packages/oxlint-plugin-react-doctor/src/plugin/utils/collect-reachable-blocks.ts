import type { BasicBlock } from "../semantic/control-flow-graph.js";

export const collectReachableBlocks = (entryBlock: BasicBlock): Set<BasicBlock> => {
  const reachableBlocks = new Set<BasicBlock>();
  const pendingBlocks = [entryBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock || reachableBlocks.has(currentBlock)) continue;
    reachableBlocks.add(currentBlock);
    for (const edge of currentBlock.successors) pendingBlocks.push(edge.to);
  }
  return reachableBlocks;
};
