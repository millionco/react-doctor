import type { BasicBlock, ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import { collectReachableBlocks } from "./collect-reachable-blocks.js";
import type { EsTreeNode } from "./es-tree-node.js";

export const createReachableNodeChecker = (
  controlFlow: ControlFlowAnalysis,
): ((node: EsTreeNode) => boolean) => {
  const reachableBlocksByFunction = new Map<EsTreeNode, Set<BasicBlock>>();
  return (node) => {
    const owner = controlFlow.enclosingFunction(node);
    if (!owner) return false;
    const functionControlFlow = controlFlow.cfgFor(owner);
    const block = functionControlFlow?.blockOf(node);
    if (!functionControlFlow || !block) return false;
    let reachableBlocks = reachableBlocksByFunction.get(owner);
    if (!reachableBlocks) {
      reachableBlocks = collectReachableBlocks(functionControlFlow.entry);
      reachableBlocksByFunction.set(owner, reachableBlocks);
    }
    return reachableBlocks.has(block);
  };
};
