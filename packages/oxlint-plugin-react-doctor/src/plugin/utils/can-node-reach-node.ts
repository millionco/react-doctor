import type { FunctionCfg } from "../semantic/control-flow-graph.js";
import type { EsTreeNode } from "./es-tree-node.js";

const reachableBlockIdsByCfg = new WeakMap<FunctionCfg, Map<number, ReadonlySet<number>>>();

export const canNodeReachNode = (
  sourceNode: EsTreeNode,
  targetNode: EsTreeNode,
  functionCfg: FunctionCfg,
): boolean => {
  const sourceBlock = functionCfg.blockOf(sourceNode);
  const targetBlock = functionCfg.blockOf(targetNode);
  if (!sourceBlock || !targetBlock) return false;
  if (sourceBlock === targetBlock) {
    return (sourceNode.range?.[0] ?? 0) <= (targetNode.range?.[0] ?? 0);
  }

  const reachableBlockIdsBySource = reachableBlockIdsByCfg.get(functionCfg) ?? new Map();
  reachableBlockIdsByCfg.set(functionCfg, reachableBlockIdsBySource);
  const cachedReachableBlockIds = reachableBlockIdsBySource.get(sourceBlock.id);
  if (cachedReachableBlockIds) return cachedReachableBlockIds.has(targetBlock.id);

  const pendingBlocks = [sourceBlock];
  const reachableBlockIds = new Set([sourceBlock.id]);
  while (pendingBlocks.length > 0) {
    const block = pendingBlocks.pop();
    if (!block) break;
    for (const edge of block.successors) {
      if (reachableBlockIds.has(edge.to.id)) continue;
      reachableBlockIds.add(edge.to.id);
      pendingBlocks.push(edge.to);
    }
  }
  reachableBlockIdsBySource.set(sourceBlock.id, reachableBlockIds);
  return reachableBlockIds.has(targetBlock.id);
};
