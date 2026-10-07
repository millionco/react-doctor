import type { EsTreeNode } from "./es-tree-node.js";
import { getRangeStart } from "./get-range-start.js";
import { isNodeReachableWithinFunction } from "./is-node-reachable-within-function.js";
import type { RuleContext } from "./rule-context.js";

export const canNodeReachLaterNodeWithinFunction = (
  sourceNode: EsTreeNode,
  targetNode: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const functionControlFlow = context.cfg.cfgFor(owner);
  const sourceBlock = functionControlFlow?.blockOf(sourceNode);
  const targetBlock = functionControlFlow?.blockOf(targetNode);
  const sourceStart = getRangeStart(sourceNode);
  const targetStart = getRangeStart(targetNode);
  if (
    !functionControlFlow ||
    !sourceBlock ||
    !targetBlock ||
    sourceStart === null ||
    targetStart === null
  ) {
    return true;
  }
  if (!isNodeReachableWithinFunction(sourceNode, context)) return false;
  if (sourceBlock === targetBlock) return sourceStart < targetStart;
  const visitedBlocks = new Set([sourceBlock]);
  const pendingBlocks = [sourceBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (edge.to === targetBlock) return true;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};
