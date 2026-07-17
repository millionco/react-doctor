import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isNodeOfType } from "./is-node-of-type.js";

const appendDescendants = (
  children: ReadonlyArray<EsTreeNode>,
  descendants: Array<EsTreeNodeOfType<"JSXOpeningElement">>,
): void => {
  for (const child of children) {
    if (isNodeOfType(child, "JSXElement")) {
      descendants.push(child.openingElement);
      appendDescendants(child.children, descendants);
    } else if (isNodeOfType(child, "JSXFragment")) {
      appendDescendants(child.children, descendants);
    }
  }
};

export const getStaticJsxDescendantOpeningElements = (
  element: EsTreeNodeOfType<"JSXElement">,
): Array<EsTreeNodeOfType<"JSXOpeningElement">> => {
  const descendants: Array<EsTreeNodeOfType<"JSXOpeningElement">> = [];
  appendDescendants(element.children, descendants);
  return descendants;
};
