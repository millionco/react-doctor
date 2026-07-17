import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

const PAGE_COPY_ROOT_NAMES = new Set(["article", "main"]);

const isPageCopyRoot = (node: EsTreeNodeOfType<"JSXElement">): boolean =>
  isNodeOfType(node.openingElement.name, "JSXIdentifier") &&
  PAGE_COPY_ROOT_NAMES.has(node.openingElement.name.name);

export const isTopLevelPageCopyRoot = (node: EsTreeNodeOfType<"JSXElement">): boolean => {
  if (!isPageCopyRoot(node)) return false;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isNodeOfType(ancestor, "JSXElement") && isPageCopyRoot(ancestor)) return false;
    ancestor = ancestor.parent;
  }
  return true;
};
