import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticJsxOpeningElements = (
  node: EsTreeNodeOfType<"JSXElement">,
): Array<EsTreeNodeOfType<"JSXOpeningElement">> => {
  const openingElements: Array<EsTreeNodeOfType<"JSXOpeningElement">> = [];
  if (isNodeOfType(node.openingElement, "JSXOpeningElement")) {
    openingElements.push(node.openingElement);
  }
  for (const child of node.children ?? []) {
    if (isNodeOfType(child, "JSXElement")) {
      openingElements.push(...getStaticJsxOpeningElements(child));
    }
  }
  return openingElements;
};
