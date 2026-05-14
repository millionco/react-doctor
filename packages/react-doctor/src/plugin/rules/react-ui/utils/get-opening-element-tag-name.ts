import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const getOpeningElementTagName = (
  openingElement: EsTreeNode | null | undefined,
): string | null => {
  if (!openingElement) return null;
  if (!isNodeOfType(openingElement, "JSXOpeningElement")) return null;
  if (isNodeOfType(openingElement.name, "JSXIdentifier")) return openingElement.name.name;
  if (isNodeOfType(openingElement.name, "JSXMemberExpression")) {
    let cursor: EsTreeNode = openingElement.name;
    while (isNodeOfType(cursor, "JSXMemberExpression")) {
      cursor = cursor.property;
    }
    if (isNodeOfType(cursor, "JSXIdentifier")) return cursor.name;
  }
  return null;
};
