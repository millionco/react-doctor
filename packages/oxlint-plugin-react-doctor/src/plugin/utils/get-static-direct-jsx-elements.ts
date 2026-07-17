import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticDirectJsxElements = (
  element: EsTreeNodeOfType<"JSXElement">,
): Array<EsTreeNodeOfType<"JSXElement">> => {
  const directElements: Array<EsTreeNodeOfType<"JSXElement">> = [];
  for (const child of element.children) {
    if (isNodeOfType(child, "JSXElement")) directElements.push(child);
  }
  return directElements;
};
