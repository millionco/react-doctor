import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

const collectStaticJsxOpeningElements = (
  node: EsTreeNode,
  openingElements: Array<EsTreeNodeOfType<"JSXOpeningElement">>,
): void => {
  if (isNodeOfType(node, "JSXElement")) openingElements.push(node.openingElement);
  if (!isNodeOfType(node, "JSXElement") && !isNodeOfType(node, "JSXFragment")) return;
  for (const child of node.children) collectStaticJsxOpeningElements(child, openingElements);
};

export const getStaticJsxOpeningElements = (
  node: EsTreeNodeOfType<"JSXElement"> | EsTreeNodeOfType<"JSXFragment">,
): Array<EsTreeNodeOfType<"JSXOpeningElement">> => {
  const openingElements: Array<EsTreeNodeOfType<"JSXOpeningElement">> = [];
  collectStaticJsxOpeningElements(node, openingElements);
  return openingElements;
};
