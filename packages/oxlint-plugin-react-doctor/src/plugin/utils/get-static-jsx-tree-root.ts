import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticJsxTreeRoot = (
  node: EsTreeNodeOfType<"JSXOpeningElement">,
): EsTreeNode | null => {
  let current: EsTreeNode | null | undefined = node.parent;
  let root: EsTreeNode | null = null;
  while (current) {
    if (isNodeOfType(current, "JSXExpressionContainer")) return null;
    if (isNodeOfType(current, "JSXElement") || isNodeOfType(current, "JSXFragment")) root = current;
    current = current.parent;
  }
  return root;
};
