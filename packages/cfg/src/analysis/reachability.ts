import type { BasicBlock, CfgEdge, FunctionCfg } from "../ir/basic-block.js";

export const isBlockReachableFromBlock = (
  fromBlock: BasicBlock,
  toBlock: BasicBlock,
  includeEdge: (edge: CfgEdge) => boolean = () => true,
): boolean => {
  const visited = new Set<BasicBlock>();
  const queue: BasicBlock[] = [fromBlock];
  // Head index instead of `queue.shift()` (O(V) per dequeue) keeps the
  // traversal O(V+E).
  let head = 0;
  while (head < queue.length) {
    const block = queue[head++]!;
    for (const edge of block.successors) {
      if (!includeEdge(edge)) continue;
      if (edge.to === toBlock) return true;
      if (!visited.has(edge.to)) {
        visited.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return false;
};

// Blocks reachable from entry over EVERY edge kind (including catch
// edges). Used to answer `isUnreachable` — a block with no path from
// entry is dead code.
export const computeReachableFromEntry = (cfg: FunctionCfg): Set<BasicBlock> => {
  const visited = new Set<BasicBlock>();
  const queue: BasicBlock[] = [cfg.entry];
  // Head index instead of `queue.shift()` (O(V) per dequeue) keeps the
  // traversal O(V+E).
  let head = 0;
  while (head < queue.length) {
    const block = queue[head++]!;
    if (visited.has(block)) continue;
    visited.add(block);
    for (const edge of block.successors) queue.push(edge.to);
  }
  return visited;
};
