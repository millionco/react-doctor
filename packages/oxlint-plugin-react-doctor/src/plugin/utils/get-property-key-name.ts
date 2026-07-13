import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getPropertyKeyName = (
  propertyKey: EsTreeNode | null | undefined,
): string | undefined => {
  if (isNodeOfType(propertyKey, "Identifier") || isNodeOfType(propertyKey, "PrivateIdentifier")) {
    return propertyKey.name;
  }
  return undefined;
};
