import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const resolveFirstArgumentBinding = (
  firstParameter: EsTreeNode | null | undefined,
): EsTreeNode | null => {
  if (!firstParameter) return null;
  if (!isNodeOfType(firstParameter, "RestElement")) return firstParameter;
  if (!isNodeOfType(firstParameter.argument, "ArrayPattern")) return null;
  const elements = firstParameter.argument.elements ?? [];
  if (elements.length !== 1) return null;
  const firstBinding = elements[0];
  if (!firstBinding || isNodeOfType(firstBinding, "RestElement")) return null;
  return firstBinding;
};
