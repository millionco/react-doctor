import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

export const doNodesCoverEveryPathFromFunctionEntry = (
  owner: EsTreeNode,
  matchingNodes: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
): boolean => {
  const functionCfg = context.cfg.cfgFor(owner);
  if (!functionCfg) return false;
  const matchingBlocks = new Set(
    matchingNodes.flatMap((matchingNode) => {
      if (context.cfg.enclosingFunction(matchingNode) !== owner) return [];
      const matchingBlock = functionCfg.blockOf(matchingNode);
      return matchingBlock ? [matchingBlock] : [];
    }),
  );
  if (matchingBlocks.size === 0) return false;
  const visitedBlocks = new Set([functionCfg.entry]);
  const pendingBlocks = [functionCfg.entry];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    if (matchingBlocks.has(currentBlock)) continue;
    for (const edge of currentBlock.successors) {
      if (edge.to === functionCfg.exit) return false;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return true;
};
