import type { EsTreeNode } from "./es-tree-node.js";
import { pushChildNodesInReverse } from "./push-child-nodes-in-reverse.js";

export const someAst = (node: EsTreeNode, predicate: (child: EsTreeNode) => boolean): boolean => {
  if (!node || typeof node !== "object") return false;
  const pendingNodes: EsTreeNode[] = [node];
  while (pendingNodes.length > 0) {
    const currentNode = pendingNodes.pop();
    if (currentNode === undefined) continue;
    if (predicate(currentNode)) return true;
    pushChildNodesInReverse(currentNode, pendingNodes);
  }
  return false;
};
