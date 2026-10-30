import type { EsTreeNode } from "./es-tree-node.js";
import { isInsideStaticallyUnreachableBranch } from "./is-inside-statically-unreachable-branch.js";
import type { RuleContext } from "./rule-context.js";

export const isNodeReachableWithinFunction = (node: EsTreeNode, context: RuleContext): boolean => {
  if (isInsideStaticallyUnreachableBranch(node)) return false;
  const owner = context.cfg.enclosingFunction(node);
  if (!owner) return true;
  const functionCfg = context.cfg.cfgFor(owner);
  if (!functionCfg) return true;
  const targetBlock = functionCfg.blockOf(node);
  if (!targetBlock) return true;
  const visitedBlocks = new Set([functionCfg.entry]);
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (currentBlock === targetBlock) return true;
    for (const edge of currentBlock.successors) {
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return false;
};
