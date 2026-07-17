import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticArrayExpressionLength = (
  node: EsTreeNode | null | undefined,
): number | null => {
  if (!node || !isNodeOfType(node, "ArrayExpression")) return null;
  return node.elements.every((element) => element && !isNodeOfType(element, "SpreadElement"))
    ? node.elements.length
    : null;
};
