import type { EsTreeNode } from "./es-tree-node.js";
import { isMutatingMethodProperty } from "./is-mutating-method-property.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const isMutatingFetchCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "fetch") return false;
  const optionsArgument = node.arguments?.[1];
  if (!optionsArgument || !isNodeOfType(optionsArgument, "ObjectExpression")) return false;
  return Boolean(optionsArgument.properties?.some(isMutatingMethodProperty));
};
