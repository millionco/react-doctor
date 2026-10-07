import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { RUNTIME_VISITOR_KEYS } from "./runtime-visitor-keys.js";

export const pushChildNodesInReverse = (node: EsTreeNode, pendingNodes: EsTreeNode[]): void => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  const childKeys = RUNTIME_VISITOR_KEYS[node.type];
  if (childKeys !== undefined) {
    for (let keyIndex = childKeys.length - 1; keyIndex >= 0; keyIndex -= 1) {
      const child = nodeRecord[childKeys[keyIndex]];
      if (Array.isArray(child)) {
        for (let itemIndex = child.length - 1; itemIndex >= 0; itemIndex -= 1) {
          const item = child[itemIndex];
          if (isAstNode(item)) pendingNodes.push(item);
        }
      } else if (isAstNode(child)) {
        pendingNodes.push(child);
      }
    }
    return;
  }
  const ownKeys = Object.keys(nodeRecord);
  for (let keyIndex = ownKeys.length - 1; keyIndex >= 0; keyIndex -= 1) {
    const key = ownKeys[keyIndex];
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (let itemIndex = child.length - 1; itemIndex >= 0; itemIndex -= 1) {
        const item = child[itemIndex];
        if (isAstNode(item)) pendingNodes.push(item);
      }
    } else if (isAstNode(child)) {
      pendingNodes.push(child);
    }
  }
};
