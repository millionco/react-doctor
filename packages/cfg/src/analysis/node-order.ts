import type { EsTreeNode } from "../ast/es-tree-node.js";
import { forEachChildNode } from "../ast/for-each-child-node.js";
import { isFunctionLike } from "../ast/is-function-like.js";

// Source-order index for every node owned by this function (not
// descending into nested functions). Used to break ties for two nodes
// that share a basic block: within a straight-line block the earlier
// node dominates the later one.
export const computeNodeOrder = (
  functionNode: EsTreeNode,
  body: EsTreeNode,
): Map<EsTreeNode, number> => {
  const nodeOrder = new Map<EsTreeNode, number>();
  let nextOrder = 0;
  const walk = (node: EsTreeNode): void => {
    if (!nodeOrder.has(node)) nodeOrder.set(node, nextOrder++);
    if (node !== functionNode && isFunctionLike(node)) return;
    forEachChildNode(node, walk);
  };
  walk(body);
  return nodeOrder;
};
