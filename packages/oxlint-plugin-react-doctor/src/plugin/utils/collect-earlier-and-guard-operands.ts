import type { EsTreeNode } from "./es-tree-node.js";
import { flattenLogicalAndChain } from "./flatten-logical-and-chain.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Walks up ancestors and collects every operand that short-circuits before
// `node` executes. Adds operands only when an `&&` ancestor holds `node` (or
// the subtree we're walking through) on its right side, since that is the
// only shape that guarantees the left operand was evaluated truthy first.
//
// `ChainExpression`, `||`, and `??` ancestors are walked through but never
// contribute operands: their own operands cannot be assumed truthy, yet an
// `&&` further up the tree still short-circuits the whole subtree and must
// remain visible.
export const collectEarlierAndGuardOperands = (node: EsTreeNode): EsTreeNode[] => {
  const earlierOperands: EsTreeNode[] = [];
  let currentNode: EsTreeNode = node;
  let parentNode: EsTreeNode | null = currentNode.parent ?? null;
  while (parentNode) {
    if (isNodeOfType(parentNode, "LogicalExpression")) {
      if (parentNode.operator === "&&" && parentNode.right === currentNode) {
        earlierOperands.push(...flattenLogicalAndChain(parentNode.left));
      }
      currentNode = parentNode;
      parentNode = currentNode.parent ?? null;
      continue;
    }
    if (isNodeOfType(parentNode, "ChainExpression")) {
      currentNode = parentNode;
      parentNode = currentNode.parent ?? null;
      continue;
    }
    break;
  }
  return earlierOperands;
};
