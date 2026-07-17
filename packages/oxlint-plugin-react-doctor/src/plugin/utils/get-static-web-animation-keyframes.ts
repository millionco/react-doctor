import type { EsTreeNode } from "./es-tree-node.js";
import { isAstNode } from "./is-ast-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticWebAnimationKeyframes = (node: EsTreeNode): ReadonlyArray<EsTreeNode> => {
  if (isNodeOfType(node, "ObjectExpression")) return [node];
  if (!isNodeOfType(node, "ArrayExpression")) return [];
  const keyframes: EsTreeNode[] = [];
  for (const element of node.elements) {
    if (isAstNode(element)) keyframes.push(element);
  }
  return keyframes;
};
