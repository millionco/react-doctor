import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { isDomElementName } from "./is-dom-element-name.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isJsxAttributeOnIntrinsicHtmlElement = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
): boolean => {
  const openingElement = attribute.parent;
  if (!openingElement) return false;
  if (!isNodeOfType(openingElement as EsTreeNode, "JSXOpeningElement")) return false;
  const elementName = (openingElement as EsTreeNodeOfType<"JSXOpeningElement">).name as EsTreeNode;
  if (!isNodeOfType(elementName, "JSXIdentifier")) return false;
  return isDomElementName(elementName.name);
};
