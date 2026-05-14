import { MUTATION_METHOD_NAMES } from "../constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

// Check for response.headers.set(), response.headers.append(), response.headers.delete()
// These are setting response headers, not mutating server state
export const isResponseHeadersCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression") || !isNodeOfType(node.callee, "MemberExpression"))
    return false;
  const { object, property } = node.callee;
  if (!isNodeOfType(property, "Identifier") || !MUTATION_METHOD_NAMES.has(property.name))
    return false;
  if (!isNodeOfType(object, "MemberExpression") || !isNodeOfType(object.object, "Identifier") || !isNodeOfType(object.property, "Identifier"))
    return false;
  return object.object.name === "response" && object.property.name === "headers";
};
