import { collectExpressionPathCoverageNodes } from "./collect-expression-path-coverage-nodes.js";
import { getRangeStart } from "./get-range-start.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";

export const doNodesCoverEveryPathAfterNode = (
  anchorNode: EsTreeNode,
  matchingNodes: ReadonlyArray<EsTreeNode>,
  context: RuleContext,
  orderingAnchorNode: EsTreeNode = anchorNode,
): boolean => {
  const owner = context.cfg.enclosingFunction(anchorNode);
  if (!owner) return false;
  const functionCfg = context.cfg.cfgFor(owner);
  if (!functionCfg) return false;
  const anchorBlock = functionCfg.blockOf(anchorNode);
  if (!anchorBlock) return false;
  const anchorStart = getRangeStart(orderingAnchorNode);
  const matchingBlocks = new Set(
    [...collectExpressionPathCoverageNodes(owner, matchingNodes, context)].flatMap(
      (matchingNode) => {
        const matchingBlock = functionCfg.blockOf(matchingNode);
        if (!matchingBlock) return [];
        const matchingStart = getRangeStart(matchingNode);
        if (
          matchingBlock === anchorBlock &&
          anchorStart !== null &&
          matchingStart !== null &&
          matchingStart < anchorStart
        ) {
          return [];
        }
        return [matchingBlock];
      },
    ),
  );
  if (matchingBlocks.has(anchorBlock)) return true;
  const visitedBlocks = new Set([anchorBlock]);
  const pendingBlocks = [anchorBlock];
  while (pendingBlocks.length > 0) {
    const currentBlock = pendingBlocks.pop();
    if (!currentBlock) break;
    for (const edge of currentBlock.successors) {
      if (matchingBlocks.has(edge.to)) continue;
      if (edge.to === functionCfg.exit) return false;
      if (visitedBlocks.has(edge.to)) continue;
      visitedBlocks.add(edge.to);
      pendingBlocks.push(edge.to);
    }
  }
  return matchingBlocks.size > 0;
};
