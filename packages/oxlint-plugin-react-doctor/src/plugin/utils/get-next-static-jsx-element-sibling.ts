import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getNextStaticJsxElementSibling = (
  node: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXElement"> | null => {
  const parent = node.parent;
  if (!parent || (!isNodeOfType(parent, "JSXElement") && !isNodeOfType(parent, "JSXFragment"))) {
    return null;
  }
  const siblings = parent.children ?? [];
  let nodeIndex = -1;
  for (let siblingIndex = 0; siblingIndex < siblings.length; siblingIndex += 1) {
    if (Object.is(siblings[siblingIndex], node)) {
      nodeIndex = siblingIndex;
      break;
    }
  }
  if (nodeIndex < 0) return null;
  for (let siblingIndex = nodeIndex + 1; siblingIndex < siblings.length; siblingIndex += 1) {
    const sibling = siblings[siblingIndex];
    if (isNodeOfType(sibling, "JSXText") && sibling.value.trim() === "") continue;
    return isNodeOfType(sibling, "JSXElement") ? sibling : null;
  }
  return null;
};
