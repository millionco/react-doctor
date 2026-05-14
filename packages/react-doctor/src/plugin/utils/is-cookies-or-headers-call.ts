import { MUTATION_METHOD_NAMES } from "../constants/library.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isCookiesOrHeadersCall = (node: EsTreeNode, methodName: string): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression"))
    return false;
  const { object, property } = node.callee;
  if (!isNodeOfType(property, "Identifier") || !MUTATION_METHOD_NAMES.has(property.name))
    return false;
  if (!isNodeOfType(object, "CallExpression") || !isNodeOfType(object.callee, "Identifier"))
    return false;
  return object.callee.name === methodName;
};
