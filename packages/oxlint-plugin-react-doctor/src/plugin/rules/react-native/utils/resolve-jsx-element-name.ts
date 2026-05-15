import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const resolveJsxElementName = (openingElement: EsTreeNode): string | null => {
  if (!isNodeOfType(openingElement, "JSXOpeningElement")) return null;
  const elementName = openingElement.name;
  if (!elementName) return null;
  if (isNodeOfType(elementName, "JSXIdentifier")) return elementName.name;
  if (isNodeOfType(elementName, "JSXMemberExpression")) {
    return isNodeOfType(elementName.property, "JSXIdentifier") ? elementName.property.name : null;
  }
  return null;
};
