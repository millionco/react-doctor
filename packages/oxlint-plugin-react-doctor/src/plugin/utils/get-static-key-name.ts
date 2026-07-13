import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";

export const getStaticKeyName = (keyNode: EsTreeNode | null | undefined): string | null => {
  if (isNodeOfType(keyNode, "Identifier")) return keyNode.name;
  if (isNodeOfType(keyNode, "Literal") && typeof keyNode.value === "string") return keyNode.value;
  return null;
};
