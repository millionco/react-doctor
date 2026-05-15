import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";

export const isFunctionLike = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "FunctionExpression") || isNodeOfType(node, "ArrowFunctionExpression");

export const isEventHandlerName = (name: string): boolean => /^on[A-Z]/.test(name);

export const getStaticMemberPropertyName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "MemberExpression")) return null;
  if (node.computed) return null;
  if (isNodeOfType(node.property, "Identifier")) return node.property.name;
  return null;
};

export const getStaticMemberReferenceName = (
  node: EsTreeNode,
  resolveName: (name: string) => string = (name) => name,
): string | null => {
  if (!isNodeOfType(node, "MemberExpression")) return null;
  if (!isNodeOfType(node.object, "Identifier")) return null;
  const propertyName = getStaticMemberPropertyName(node);
  return propertyName ? `${resolveName(node.object.name)}.${propertyName}` : null;
};

export const getStaticPropertyKeyName = (node: EsTreeNode): string | null => {
  if (!isNodeOfType(node, "Property")) return null;
  if (node.computed) return null;
  if (isNodeOfType(node.key, "Identifier")) return node.key.name;
  if (isNodeOfType(node.key, "Literal")) return String(node.key.value);
  return null;
};

export const isEventHandlerValue = (
  node: EsTreeNode,
  eventHandlerReferenceNames: Set<string>,
  resolveName: (name: string) => string = (name) => name,
): boolean => {
  if (isFunctionLike(node)) return true;
  if (isNodeOfType(node, "Identifier"))
    return eventHandlerReferenceNames.has(resolveName(node.name));
  const memberReferenceName = getStaticMemberReferenceName(node, resolveName);
  return Boolean(memberReferenceName && eventHandlerReferenceNames.has(memberReferenceName));
};

export const isIntrinsicJsxAttribute = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "JSXAttribute")) return false;
  const openingElement = node.parent;
  if (!isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  const elementName = openingElement.name;
  if (!isNodeOfType(elementName, "JSXIdentifier")) return false;
  return /^[a-z]/.test(elementName.name);
};
